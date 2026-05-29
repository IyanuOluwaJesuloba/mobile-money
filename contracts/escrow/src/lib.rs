#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, contracterror, token, Address, Env};

// ── Error types ──────────────────────────────────────────────────────────────

/// Contract-level errors surfaced via the Soroban SDK error-code mechanism.
/// The `#[contracterror]` attribute generates the required `From<soroban_sdk::Error>`
/// impl so the generated client exposes `try_*` variants that return
/// `Result<T, soroban_sdk::Error>` for testing failure paths.
#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(u32)]
pub enum EscrowError {
    /// Storage key already exists – contract is already initialised.
    AlreadyInitialised = 1,
    /// Storage key not found – contract has not been initialised yet.
    NotInitialised = 2,
    /// Funds have already been released or refunded.
    AlreadyReleased = 3,
    /// The lock time has not yet expired; refund is premature.
    LockNotExpired = 4,
    /// The lock time has already expired; arbiter release window is closed.
    LockExpired = 5,
    /// Deposit amount must be strictly positive.
    InvalidAmount = 6,
    /// Fee basis points must be in [0, 10_000].
    InvalidFeeBps = 7,
    /// Beneficiary address must differ from depositor.
    InvalidBeneficiary = 8,
    /// Arbiter address must differ from both depositor and beneficiary.
    InvalidArbiter = 9,
}

// ── State ────────────────────────────────────────────────────────────────────

/// Persistent on-chain state for a single escrow instance.
#[contracttype]
#[derive(Clone)]
pub struct EscrowState {
    /// Party that deposited funds and can claim a refund after expiry.
    pub depositor: Address,
    /// Party that receives funds on successful release.
    pub beneficiary: Address,
    /// Neutral third party that authorises release / early refund.
    pub arbiter: Address,
    /// SAC token address.
    pub token: Address,
    /// Gross amount locked in escrow (before fee deduction).
    pub amount: i128,
    /// Protocol fee in basis points (0–10 000). Taken from `amount` on release.
    pub fee_bps: u32,
    /// Address that receives the protocol fee.
    pub fee_recipient: Address,
    /// Ledger sequence number after which the depositor may self-refund.
    /// `0` disables the self-refund path entirely.
    pub lock_until_ledger: u32,
    /// `true` once funds have left the contract (either direction).
    pub released: bool,
}

impl EscrowState {
    /// Compute (fee_amount, net_beneficiary_amount).
    pub fn split(&self) -> (i128, i128) {
        let fee = self.amount * self.fee_bps as i128 / 10_000;
        let net = self.amount - fee;
        (fee, net)
    }
}

// ── Storage key ──────────────────────────────────────────────────────────────

const ESCROW: &str = "ESCROW";

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    // ── initialize ────────────────────────────────────────────────────────────

    /// Initialise escrow. The depositor must authorise this call; `amount`
    /// tokens are pulled from the depositor into the contract.
    ///
    /// * `lock_until_ledger` – ledger after which the depositor may self-refund
    ///   without the arbiter. Pass `0` to disable self-refund entirely.
    /// * `fee_bps`           – protocol fee in basis points (0–10 000).
    /// * `fee_recipient`     – receives the fee portion on release.
    pub fn initialize(
        env: Env,
        depositor: Address,
        beneficiary: Address,
        arbiter: Address,
        token: Address,
        amount: i128,
        lock_until_ledger: u32,
        fee_bps: u32,
        fee_recipient: Address,
    ) -> Result<(), EscrowError> {
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        if fee_bps > 10_000 {
            return Err(EscrowError::InvalidFeeBps);
        }
        if beneficiary == depositor {
            return Err(EscrowError::InvalidBeneficiary);
        }
        if arbiter == depositor || arbiter == beneficiary {
            return Err(EscrowError::InvalidArbiter);
        }
        if env.storage().instance().has(&ESCROW) {
            return Err(EscrowError::AlreadyInitialised);
        }

        depositor.require_auth();

        // Pull funds from depositor into the contract.
        token::Client::new(&env, &token)
            .transfer(&depositor, &env.current_contract_address(), &amount);

        env.storage().instance().set(
            &ESCROW,
            &EscrowState {
                depositor,
                beneficiary,
                arbiter,
                token,
                amount,
                fee_bps,
                fee_recipient,
                lock_until_ledger,
                released: false,
            },
        );

        Ok(())
    }

    // ── release ───────────────────────────────────────────────────────────────

    /// Release funds to the beneficiary (net of fee) and fee to `fee_recipient`.
    /// Only the arbiter may call this, and only while the lock is still active.
    pub fn release(env: Env) -> Result<(), EscrowError> {
        let mut state: EscrowState = env
            .storage()
            .instance()
            .get(&ESCROW)
            .ok_or(EscrowError::NotInitialised)?;

        state.arbiter.require_auth();

        if state.released {
            return Err(EscrowError::AlreadyReleased);
        }
        // Arbiter cannot release after the lock has expired.
        if state.lock_until_ledger > 0
            && env.ledger().sequence() > state.lock_until_ledger
        {
            return Err(EscrowError::LockExpired);
        }

        let tc = token::Client::new(&env, &state.token);
        let contract_addr = env.current_contract_address();
        let (fee, net) = state.split();

        if fee > 0 {
            tc.transfer(&contract_addr, &state.fee_recipient, &fee);
        }
        tc.transfer(&contract_addr, &state.beneficiary, &net);

        state.released = true;
        env.storage().instance().set(&ESCROW, &state);

        Ok(())
    }

    // ── refund ────────────────────────────────────────────────────────────────

    /// Return the full `amount` to the depositor.
    /// Only the arbiter may call this, and only while the lock is still active.
    pub fn refund(env: Env) -> Result<(), EscrowError> {
        let mut state: EscrowState = env
            .storage()
            .instance()
            .get(&ESCROW)
            .ok_or(EscrowError::NotInitialised)?;

        state.arbiter.require_auth();

        if state.released {
            return Err(EscrowError::AlreadyReleased);
        }
        if state.lock_until_ledger > 0
            && env.ledger().sequence() > state.lock_until_ledger
        {
            return Err(EscrowError::LockExpired);
        }

        token::Client::new(&env, &state.token)
            .transfer(&env.current_contract_address(), &state.depositor, &state.amount);

        state.released = true;
        env.storage().instance().set(&ESCROW, &state);

        Ok(())
    }

    // ── self_refund ───────────────────────────────────────────────────────────

    /// Allow the depositor to reclaim funds *after* the lock has expired,
    /// without the arbiter. The full `amount` is returned.
    pub fn self_refund(env: Env) -> Result<(), EscrowError> {
        let mut state: EscrowState = env
            .storage()
            .instance()
            .get(&ESCROW)
            .ok_or(EscrowError::NotInitialised)?;

        state.depositor.require_auth();

        if state.released {
            return Err(EscrowError::AlreadyReleased);
        }
        // Time-lock must have passed.
        if state.lock_until_ledger == 0
            || env.ledger().sequence() <= state.lock_until_ledger
        {
            return Err(EscrowError::LockNotExpired);
        }

        token::Client::new(&env, &state.token)
            .transfer(&env.current_contract_address(), &state.depositor, &state.amount);

        state.released = true;
        env.storage().instance().set(&ESCROW, &state);

        Ok(())
    }

    // ── get_state ─────────────────────────────────────────────────────────────

    /// Return current escrow state (read-only).
    pub fn get_state(env: Env) -> Result<EscrowState, EscrowError> {
        env.storage()
            .instance()
            .get(&ESCROW)
            .ok_or(EscrowError::NotInitialised)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env,
    };

    // ── Helpers ───────────────────────────────────────────────────────────────

    const MINT_AMOUNT: i128 = 1_000_000;

    /// Deploy a fresh Soroban test environment with a SAC token and an escrow
    /// contract.  All auth is mocked for simplicity.
    ///
    /// Returns: (env, depositor, beneficiary, arbiter, fee_recipient, token_addr, client)
    fn setup() -> (
        Env,
        Address,
        Address,
        Address,
        Address,
        Address,
        EscrowContractClient<'static>,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let depositor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let fee_recipient = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        StellarAssetClient::new(&env, &token_id.address()).mint(&depositor, &MINT_AMOUNT);

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        (
            env,
            depositor,
            beneficiary,
            arbiter,
            fee_recipient,
            token_id.address(),
            client,
        )
    }

    /// Advance the mock ledger sequence by `delta`.
    fn advance_ledger(env: &Env, delta: u32) {
        let current = env.ledger().sequence();
        env.ledger().set(LedgerInfo {
            protocol_version: 25,
            sequence_number: current + delta,
            timestamp: env.ledger().timestamp() + (delta as u64 * 5),
            network_id: Default::default(),
            base_reserve: 5_000_000,
            min_persistent_entry_ttl: 4096,
            min_temp_entry_ttl: 16,
            max_entry_ttl: 9_999_999,
        });
    }

    // Helper: initialise with common defaults
    fn init(
        client: &EscrowContractClient,
        depositor: &Address,
        beneficiary: &Address,
        arbiter: &Address,
        token: &Address,
        amount: i128,
        lock_until_ledger: u32,
        fee_bps: u32,
        fee_recipient: &Address,
    ) {
        client
            .try_initialize(
                depositor,
                beneficiary,
                arbiter,
                token,
                &amount,
                &lock_until_ledger,
                &fee_bps,
                fee_recipient,
            )
            .expect("initialize should succeed")
            .expect("initialize returned error");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Happy-path tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_initialize_stores_correct_state() {
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let amount: i128 = 500_000;

        init(&client, &depositor, &beneficiary, &arbiter, &token, amount, 100, 250, &fee_recipient);

        let state = client
            .try_get_state()
            .expect("try_get_state panicked")
            .expect("get_state returned error");

        assert_eq!(state.amount, amount);
        assert_eq!(state.fee_bps, 250);
        assert_eq!(state.lock_until_ledger, 100);
        assert!(!state.released);

        // Depositor's balance should decrease by `amount`.
        let tc = TokenClient::new(&env, &token);
        assert_eq!(tc.balance(&depositor), MINT_AMOUNT - amount);
    }

    #[test]
    fn test_release_distributes_fee_and_net() {
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let amount: i128 = 500_000;
        // 2.5 % fee → fee = 12 500, net = 487 500
        let fee_bps: u32 = 250;

        init(&client, &depositor, &beneficiary, &arbiter, &token, amount, 100, fee_bps, &fee_recipient);

        client
            .try_release()
            .expect("try_release panicked")
            .expect("release returned error");

        let tc = TokenClient::new(&env, &token);
        let expected_fee = amount * fee_bps as i128 / 10_000;
        let expected_net = amount - expected_fee;

        assert_eq!(tc.balance(&beneficiary), expected_net);
        assert_eq!(tc.balance(&fee_recipient), expected_fee);

        let state = client
            .try_get_state()
            .expect("try_get_state panicked")
            .expect("get_state returned error");
        assert!(state.released);
    }

    #[test]
    fn test_release_with_zero_fee() {
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let amount: i128 = 300_000;

        init(&client, &depositor, &beneficiary, &arbiter, &token, amount, 50, 0, &fee_recipient);

        client
            .try_release()
            .expect("try_release panicked")
            .expect("release returned error");

        let tc = TokenClient::new(&env, &token);
        // Full amount goes to beneficiary; fee_recipient receives nothing.
        assert_eq!(tc.balance(&beneficiary), amount);
        assert_eq!(tc.balance(&fee_recipient), 0);
    }

    #[test]
    fn test_refund_returns_full_amount_to_depositor() {
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let amount: i128 = 200_000;

        init(&client, &depositor, &beneficiary, &arbiter, &token, amount, 50, 100, &fee_recipient);

        client
            .try_refund()
            .expect("try_refund panicked")
            .expect("refund returned error");

        let tc = TokenClient::new(&env, &token);
        // Depositor gets full amount back (no fee on refund).
        assert_eq!(tc.balance(&depositor), MINT_AMOUNT);

        let state = client
            .try_get_state()
            .expect("try_get_state panicked")
            .expect("get_state returned error");
        assert!(state.released);
    }

    #[test]
    fn test_self_refund_after_lock_expiry() {
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let amount: i128 = 400_000;
        let lock_ledger: u32 = 50;

        init(&client, &depositor, &beneficiary, &arbiter, &token, amount, lock_ledger, 0, &fee_recipient);

        // Move past the lock.
        advance_ledger(&env, lock_ledger + 1);

        client
            .try_self_refund()
            .expect("try_self_refund panicked")
            .expect("self_refund returned error");

        let tc = TokenClient::new(&env, &token);
        assert_eq!(tc.balance(&depositor), MINT_AMOUNT);

        let state = client
            .try_get_state()
            .expect("try_get_state panicked")
            .expect("get_state returned error");
        assert!(state.released);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Failure / edge-case tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_double_initialize_fails() {
        let (_env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let amount: i128 = 100_000;

        init(&client, &depositor, &beneficiary, &arbiter, &token, amount, 0, 0, &fee_recipient);

        // Second initialise must be rejected.
        let result = client.try_initialize(
            &depositor, &beneficiary, &arbiter, &token,
            &amount, &0_u32, &0_u32, &fee_recipient,
        );
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_initialize_zero_amount_fails() {
        let (_env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();

        let result = client.try_initialize(
            &depositor, &beneficiary, &arbiter, &token,
            &0_i128, &0_u32, &0_u32, &fee_recipient,
        );
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_initialize_negative_amount_fails() {
        let (_env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();

        let result = client.try_initialize(
            &depositor, &beneficiary, &arbiter, &token,
            &(-1_i128), &0_u32, &0_u32, &fee_recipient,
        );
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_initialize_fee_above_10000_fails() {
        let (_env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();

        let result = client.try_initialize(
            &depositor, &beneficiary, &arbiter, &token,
            &100_000_i128, &0_u32, &10_001_u32, &fee_recipient,
        );
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_initialize_beneficiary_equals_depositor_fails() {
        let (_env, depositor, _beneficiary, arbiter, fee_recipient, token, client) = setup();

        // Beneficiary == depositor must be rejected.
        let result = client.try_initialize(
            &depositor, &depositor, &arbiter, &token,
            &100_000_i128, &0_u32, &0_u32, &fee_recipient,
        );
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_initialize_arbiter_equals_depositor_fails() {
        let (_env, depositor, beneficiary, _arbiter, fee_recipient, token, client) = setup();

        // Arbiter == depositor must be rejected.
        let result = client.try_initialize(
            &depositor, &beneficiary, &depositor, &token,
            &100_000_i128, &0_u32, &0_u32, &fee_recipient,
        );
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_initialize_arbiter_equals_beneficiary_fails() {
        let (_env, depositor, beneficiary, _arbiter, fee_recipient, token, client) = setup();

        // Arbiter == beneficiary must be rejected.
        let result = client.try_initialize(
            &depositor, &beneficiary, &beneficiary, &token,
            &100_000_i128, &0_u32, &0_u32, &fee_recipient,
        );
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_release_without_initialize_fails() {
        let (_env, _d, _b, _a, _f, _t, client) = setup();

        let result = client.try_release();
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_refund_without_initialize_fails() {
        let (_env, _d, _b, _a, _f, _t, client) = setup();

        let result = client.try_refund();
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_self_refund_without_initialize_fails() {
        let (_env, _d, _b, _a, _f, _t, client) = setup();

        let result = client.try_self_refund();
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_release_after_already_released_fails() {
        let (_env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();

        init(&client, &depositor, &beneficiary, &arbiter, &token, 100_000, 0, 0, &fee_recipient);

        client
            .try_release()
            .expect("try_release panicked")
            .expect("first release failed");

        // Second release must fail.
        let result = client.try_release();
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_refund_after_already_released_fails() {
        let (_env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();

        init(&client, &depositor, &beneficiary, &arbiter, &token, 100_000, 0, 0, &fee_recipient);

        client
            .try_refund()
            .expect("try_refund panicked")
            .expect("first refund failed");

        let result = client.try_refund();
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_premature_self_refund_before_expiry_fails() {
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let lock_ledger: u32 = 100;

        init(&client, &depositor, &beneficiary, &arbiter, &token, 500_000, lock_ledger, 0, &fee_recipient);

        // Lock has NOT expired yet – advance only half-way.
        advance_ledger(&env, 50);
        let result = client.try_self_refund();
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_self_refund_at_exact_expiry_ledger_fails() {
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let lock_ledger: u32 = 100;

        init(&client, &depositor, &beneficiary, &arbiter, &token, 500_000, lock_ledger, 0, &fee_recipient);

        // Exactly at the lock ledger – still locked (sequence <= lock_until).
        advance_ledger(&env, lock_ledger);
        let result = client.try_self_refund();
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_arbiter_release_after_lock_expired_fails() {
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let lock_ledger: u32 = 50;

        init(&client, &depositor, &beneficiary, &arbiter, &token, 500_000, lock_ledger, 0, &fee_recipient);

        // Move past the lock – arbiter window is now closed.
        advance_ledger(&env, lock_ledger + 5);
        let result = client.try_release();
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_arbiter_refund_after_lock_expired_fails() {
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let lock_ledger: u32 = 50;

        init(&client, &depositor, &beneficiary, &arbiter, &token, 500_000, lock_ledger, 0, &fee_recipient);

        advance_ledger(&env, lock_ledger + 5);
        let result = client.try_refund();
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_self_refund_with_no_lock_fails() {
        let (_env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();

        // lock_until_ledger = 0 disables the self-refund path.
        init(&client, &depositor, &beneficiary, &arbiter, &token, 200_000, 0, 0, &fee_recipient);

        let result = client.try_self_refund();
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn test_get_state_before_initialize_fails() {
        let (_env, _d, _b, _a, _f, _t, client) = setup();

        let result = client.try_get_state();
        assert!(result.is_err() || result.unwrap().is_err());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Fee-distribution edge cases
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_release_maximum_fee_bps() {
        // 100 % fee – all funds go to fee_recipient, beneficiary gets zero.
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let amount: i128 = 100_000;

        init(&client, &depositor, &beneficiary, &arbiter, &token, amount, 0, 10_000, &fee_recipient);

        client
            .try_release()
            .expect("try_release panicked")
            .expect("release failed");

        let tc = TokenClient::new(&env, &token);
        assert_eq!(tc.balance(&fee_recipient), amount);
        assert_eq!(tc.balance(&beneficiary), 0);
    }

    #[test]
    fn test_fee_rounds_down_correctly() {
        // 1 bps on 999 tokens → floor(999 * 1 / 10_000) = 0
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let amount: i128 = 999;

        init(&client, &depositor, &beneficiary, &arbiter, &token, amount, 0, 1, &fee_recipient);

        client
            .try_release()
            .expect("try_release panicked")
            .expect("release failed");

        let tc = TokenClient::new(&env, &token);
        assert_eq!(tc.balance(&beneficiary), 999); // fee rounds to zero
        assert_eq!(tc.balance(&fee_recipient), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Ledger simulation / network-condition tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_release_just_before_lock_expiry_succeeds() {
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let lock_ledger: u32 = 200;
        let amount: i128 = 500_000;

        init(&client, &depositor, &beneficiary, &arbiter, &token, amount, lock_ledger, 0, &fee_recipient);

        // One ledger before the lock.
        advance_ledger(&env, lock_ledger - 1);

        client
            .try_release()
            .expect("try_release panicked")
            .expect("release failed");

        let tc = TokenClient::new(&env, &token);
        assert_eq!(tc.balance(&beneficiary), amount);
    }

    #[test]
    fn test_self_refund_one_ledger_after_expiry() {
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let lock_ledger: u32 = 10;
        let amount: i128 = 250_000;

        init(&client, &depositor, &beneficiary, &arbiter, &token, amount, lock_ledger, 0, &fee_recipient);

        advance_ledger(&env, lock_ledger + 1);

        client
            .try_self_refund()
            .expect("try_self_refund panicked")
            .expect("self_refund failed");

        let tc = TokenClient::new(&env, &token);
        assert_eq!(tc.balance(&depositor), MINT_AMOUNT);
    }

    #[test]
    fn test_full_lifecycle_with_fee_and_lock() {
        let (env, depositor, beneficiary, arbiter, fee_recipient, token, client) = setup();
        let amount: i128 = 800_000;
        let fee_bps: u32 = 500; // 5 %
        let lock_ledger: u32 = 30;

        init(&client, &depositor, &beneficiary, &arbiter, &token, amount, lock_ledger, fee_bps, &fee_recipient);

        // Arbiter releases while lock is active.
        advance_ledger(&env, 20);

        client
            .try_release()
            .expect("try_release panicked")
            .expect("release failed");

        let tc = TokenClient::new(&env, &token);
        let expected_fee = amount * fee_bps as i128 / 10_000; // 40_000
        let expected_net = amount - expected_fee;              // 760_000

        assert_eq!(tc.balance(&beneficiary), expected_net);
        assert_eq!(tc.balance(&fee_recipient), expected_fee);
        assert_eq!(tc.balance(&depositor), MINT_AMOUNT - amount);

        let state = client
            .try_get_state()
            .expect("try_get_state panicked")
            .expect("get_state returned error");
        assert!(state.released);
    }
}
