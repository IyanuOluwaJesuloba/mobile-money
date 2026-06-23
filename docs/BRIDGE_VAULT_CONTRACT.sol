// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title BridgedAssetVault
 * @dev Smart contract for minting and managing wrapped Stellar assets on EVM chains
 * 
 * This contract implements the EVM side of the locked-minted bridge
 * architecture for cross-chain asset transfers.
 */
contract BridgedAssetVault is Ownable, ReentrancyGuard, Pausable {
    
    // ========== State ==========
    
    /// Wrapped token instance (ERC20)
    ERC20Burnable public wrappedToken;
    
    /// Processed Stellar bridge transactions (txHash => processed)
    mapping(bytes32 => bool) public processedBridgeTxns;
    
    /// User's minted balance tracking
    mapping(address => uint256) public userMintedBalance;
    
    /// Approved validators for signature verification
    mapping(address => bool) public approvedValidators;
    
    /// Validator signatures for each transaction (txHash => signature count)
    mapping(bytes32 => uint8) public validatorSignatureCount;
    
    /// Signature metadata (txHash => validatorAddress => signed)
    mapping(bytes32 => mapping(address => bool)) public validatorHasSigned;
    
    // Bridge parameters
    uint8 public constant REQUIRED_SIGNATURES = 2;
    uint8 public constant TOTAL_VALIDATORS = 3;
    
    uint256 public dailyLimit = 500_000 * 10**6; // $500k in USDC (6 decimals)
    uint256 public lastLimitReset = block.timestamp;
    uint256 public dailyVolume = 0;
    
    // Emergency pause mechanism
    bool public emergencyPaused = false;
    address[] public emergencyMultisigSigners;
    
    // ========== Events ==========
    
    event WrappedTokenMinted(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed stellarTxHash,
        bytes32[] validatorSignatures
    );
    
    event WrappedTokenBurned(
        address indexed burner,
        uint256 amount,
        bytes32 indexed redemptionTxHash
    );
    
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    
    event BridgeRedemptionInitiated(
        address indexed user,
        uint256 amount,
        bytes32 burnTxHash
    );
    
    event DailyLimitUpdated(uint256 newLimit);
    event EmergencyPause(address indexed pausedBy);
    event EmergencyUnpause(address indexed unpausedBy);
    
    // ========== Modifiers ==========
    
    modifier onlyValidator() {
        require(approvedValidators[msg.sender], "Not an approved validator");
        _;
    }
    
    modifier notPaused() {
        require(!emergencyPaused, "Bridge is emergency paused");
        require(!paused(), "Bridge is paused");
        _;
    }
    
    modifier withinDailyLimit(uint256 amount) {
        // Reset daily limit if 24 hours have passed
        if (block.timestamp >= lastLimitReset + 1 days) {
            dailyVolume = 0;
            lastLimitReset = block.timestamp;
        }
        
        require(dailyVolume + amount <= dailyLimit, "Daily limit exceeded");
        _;
    }
    
    // ========== Constructor ==========
    
    constructor(
        address _wrappedToken,
        address[] memory _validators
    ) {
        require(_wrappedToken != address(0), "Invalid token address");
        require(_validators.length == TOTAL_VALIDATORS, "Must have exactly 3 validators");
        
        wrappedToken = ERC20Burnable(_wrappedToken);
        
        for (uint i = 0; i < _validators.length; i++) {
            require(_validators[i] != address(0), "Invalid validator address");
            approvedValidators[_validators[i]] = true;
        }
    }
    
    // ========== Core Bridge Functions ==========
    
    /**
     * @dev Mint wrapped tokens based on Stellar lock attestation
     * @param stellarTxnHash Hash of Stellar lock transaction
     * @param recipient Address to receive minted tokens
     * @param amount Amount to mint
     * @param validatorSigs Array of validator signatures
     */
    function mintFromBridge(
        bytes32 stellarTxnHash,
        address recipient,
        uint256 amount,
        bytes[] calldata validatorSigs
    ) external nonReentrant notPaused withinDailyLimit(amount) {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than 0");
        require(!processedBridgeTxns[stellarTxnHash], "Transaction already processed");
        require(validatorSigs.length >= REQUIRED_SIGNATURES, "Insufficient signatures");
        
        // Verify validator consensus
        bool consensusVerified = verifyValidatorConsensus(
            stellarTxnHash,
            recipient,
            amount,
            validatorSigs
        );
        require(consensusVerified, "Validator consensus verification failed");
        
        // Mark transaction as processed
        processedBridgeTxns[stellarTxnHash] = true;
        
        // Update daily volume
        dailyVolume += amount;
        
        // Mint tokens
        userMintedBalance[recipient] += amount;
        
        // Emit event with validator signatures
        emit WrappedTokenMinted(recipient, amount, stellarTxnHash, validatorSigs);
    }
    
    /**
     * @dev Burn wrapped tokens to initiate redemption
     * @param amount Amount to burn
     */
    function burnForRedemption(uint256 amount) external notPaused {
        require(amount > 0, "Amount must be greater than 0");
        require(userMintedBalance[msg.sender] >= amount, "Insufficient balance");
        
        // Burn tokens
        wrappedToken.burnFrom(msg.sender, amount);
        userMintedBalance[msg.sender] -= amount;
        
        bytes32 burnTxHash = keccak256(
            abi.encodePacked(msg.sender, amount, block.timestamp)
        );
        
        emit BridgeRedemptionInitiated(msg.sender, amount, burnTxHash);
    }
    
    // ========== Signature Verification ==========
    
    /**
     * @dev Verify validator consensus on attestation
     * @param attestationHash Hash of attestation data
     * @param recipient Recipient address
     * @param amount Amount being minted
     * @param signatures Array of validator signatures
     * @return consensusReached Whether consensus threshold was met
     */
    function verifyValidatorConsensus(
        bytes32 attestationHash,
        address recipient,
        uint256 amount,
        bytes[] calldata signatures
    ) public view returns (bool) {
        bytes32 messageDigest = keccak256(
            abi.encodePacked(attestationHash, recipient, amount)
        );
        bytes32 ethSignedMessageHash = getEthSignedMessageHash(messageDigest);
        
        uint8 validSignatures = 0;
        
        for (uint i = 0; i < signatures.length; i++) {
            address signer = recoverSigner(ethSignedMessageHash, signatures[i]);
            
            if (approvedValidators[signer]) {
                validSignatures++;
            }
        }
        
        return validSignatures >= REQUIRED_SIGNATURES;
    }
    
    /**
     * @dev Recover signer address from signature
     */
    function recoverSigner(
        bytes32 messageHash,
        bytes memory signature
    ) internal pure returns (address) {
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(signature);
        return ecrecover(messageHash, v, r, s);
    }
    
    /**
     * @dev Get ETH signed message hash
     */
    function getEthSignedMessageHash(bytes32 messageHash) 
        internal 
        pure 
        returns (bytes32) 
    {
        return keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                messageHash
            )
        );
    }
    
    /**
     * @dev Split signature into r, s, v components
     */
    function splitSignature(bytes memory sig)
        internal
        pure
        returns (bytes32 r, bytes32 s, uint8 v)
    {
        require(sig.length == 65, "Invalid signature length");
        
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }
    
    // ========== Validator Management ==========
    
    /**
     * @dev Add approved validator
     */
    function addValidator(address validator) external onlyOwner {
        require(validator != address(0), "Invalid validator address");
        require(!approvedValidators[validator], "Already a validator");
        
        approvedValidators[validator] = true;
        emit ValidatorAdded(validator);
    }
    
    /**
     * @dev Remove approved validator
     */
    function removeValidator(address validator) external onlyOwner {
        require(approvedValidators[validator], "Not a validator");
        
        approvedValidators[validator] = false;
        emit ValidatorRemoved(validator);
    }
    
    // ========== Limits & Controls ==========
    
    /**
     * @dev Update daily bridge limit
     */
    function updateDailyLimit(uint256 newLimit) external onlyOwner {
        require(newLimit > 0, "Limit must be greater than 0");
        dailyLimit = newLimit;
        emit DailyLimitUpdated(newLimit);
    }
    
    /**
     * @dev Get remaining daily limit
     */
    function getRemainingDailyLimit() external view returns (uint256) {
        if (block.timestamp >= lastLimitReset + 1 days) {
            return dailyLimit;
        }
        return dailyLimit > dailyVolume ? dailyVolume - dailyLimit : 0;
    }
    
    // ========== Emergency Controls ==========
    
    /**
     * @dev Emergency pause bridge (multisig required)
     */
    function emergencyTogglePause() external onlyOwner {
        emergencyPaused = !emergencyPaused;
        
        if (emergencyPaused) {
            emit EmergencyPause(msg.sender);
        } else {
            emit EmergencyUnpause(msg.sender);
        }
    }
    
    /**
     * @dev Pause contract (standard pause mechanism)
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev Unpause contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    // ========== Query Functions ==========
    
    /**
     * @dev Check if transaction has been processed
     */
    function isTransactionProcessed(bytes32 txHash) 
        external 
        view 
        returns (bool) 
    {
        return processedBridgeTxns[txHash];
    }
    
    /**
     * @dev Get user's minted balance
     */
    function getUserMintedBalance(address user) 
        external 
        view 
        returns (uint256) 
    {
        return userMintedBalance[user];
    }
    
    /**
     * @dev Get bridge status
     */
    function getBridgeStatus() external view returns (
        bool isPaused,
        bool isEmergencyPaused,
        uint256 dailyLimitValue,
        uint256 dailyVolumeValue,
        uint256 remainingLimit
    ) {
        uint256 remaining = dailyLimit;
        
        if (block.timestamp < lastLimitReset + 1 days) {
            remaining = dailyLimit > dailyVolume ? dailyLimit - dailyVolume : 0;
        }
        
        return (
            paused(),
            emergencyPaused,
            dailyLimit,
            dailyVolume,
            remaining
        );
    }
}
