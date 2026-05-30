import { runSubscriptionJob } from '../../jobs/subscriptionJob';
import subscriptionModel from '../../models/subscription';
import { TransactionModel } from '../../models/transaction';
import { addTransactionJob } from '../../queue/transactionQueue';

jest.mock('../../models/subscription');
jest.mock('../../models/transaction');
jest.mock('../../queue/transactionQueue');

const mockedSubModel = subscriptionModel as jest.Mocked<typeof subscriptionModel>;
const mockedAddJob = addTransactionJob as jest.MockedFunction<typeof addTransactionJob>;

describe('runSubscriptionJob', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('creates transaction and enqueues job for due subscription', async () => {
    mockedSubModel.getDueSubscriptions = jest.fn().mockResolvedValueOnce([
      {
        id: 'sub1',
        merchant_id: 'm1',
        user_id: 'u1',
        phone_number: null,
        amount: '5',
        currency: 'USD',
        interval: 'daily',
        status: 'active',
        metadata: { provider: 'mtn' },
      },
    ] as any);

    const mockCreate = jest.fn().mockResolvedValueOnce({ id: 'tx1', phoneNumber: '123', provider: 'mtn', stellarAddress: '' });
    (TransactionModel as unknown as jest.Mock).mockImplementation(() => ({ create: mockCreate }));

    mockedSubModel.recordAttempt = jest.fn().mockResolvedValue(undefined as any);

    await runSubscriptionJob();

    expect(mockCreate).toHaveBeenCalled();
    expect(mockedSubModel.recordAttempt).toHaveBeenCalledWith('sub1', 'tx1', 1, 'pending');
    expect(mockedSubModel.getDueSubscriptions).toHaveBeenCalled();
    expect(mockedAddJob).toHaveBeenCalled();
  });
});
