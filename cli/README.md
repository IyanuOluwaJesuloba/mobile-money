# momo-cli

Admin maintenance CLI for the mobile-money service.

## Setup

```bash
cd cli && npm install
```

Run the interactive setup wizard to create `cli/.momorc`:

```bash
npm run dev -- setup
```

If you prefer to create it manually, use:

```
MOMO_API_URL=https://your-production-url
MOMO_API_KEY=your-admin-api-key
```

## Commands

```bash
npm run dev -- auth check                        # verify API key
npm run dev -- status <transactionId>            # get transaction details
npm run dev -- retry <transactionId>             # force-retry a failed transaction
```
