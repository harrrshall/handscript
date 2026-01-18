<p align="center">
  <img src="public/logo.png" alt="Handscript Logo" width="80" height="80">
</p>

<h1 align="center">Handscript</h1>

<p align="center">
  <strong>Convert handwritten notes to beautifully formatted PDFs using AI</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#api-keys">Get Free API Keys</a>
</p>

---

## ✨ Features

- 📝 **AI-Powered Transcription** — Uses Google Gemini 2.5 Flash to accurately transcribe handwritten notes
- 🔢 **LaTeX Math Support** — Renders mathematical equations beautifully using KaTeX
- 📄 **PDF Generation** — Creates professional, formatted PDF documents
- 📧 **Email Delivery** — Sends completed PDFs directly to your inbox
- ⚡ **Async Processing** — Handles multi-page documents with parallel processing
- 🎨 **Modern UI** — Clean, responsive interface with glassmorphism design
- 🏠 **Local Dev Mode** — Run locally with just a Gemini API key (no external services needed!)

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [npm](https://www.npmjs.com/) or [pnpm](https://pnpm.io/)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/handscript.git
cd handscript

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### Minimal Local Setup (Just Gemini!)

For local development, you only need **one API key**:

```env
GEMINI_API_KEY=your_gemini_api_key
```

The app will automatically:
- ✅ Use **in-memory storage** instead of Redis
- ✅ Use **local filesystem** (`public/uploads/`) instead of B2 cloud storage
- ✅ Bypass QStash and process requests directly

### Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Note**: In local dev mode, files are stored in `public/uploads/` and state is kept in memory. Data will be lost when the server restarts.

---

## 🔑 Get Free API Keys

All required services offer generous free tiers!

### Google Gemini API (Required)

**Free tier**: 15 requests/minute, 1M tokens/day

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **"Create API key"**
4. Copy the key to your `.env` file

### Backblaze B2 Storage (Production)

**Free tier**: 10 GB storage, 1 GB/day download

1. Create account at [backblaze.com/b2/sign-up.html](https://www.backblaze.com/b2/sign-up.html)
2. Go to **Buckets** → **Create a Bucket** (set to Private)
3. Go to **App Keys** → **Add a New Application Key**
4. Copy `keyID`, `applicationKey`, and note your bucket endpoint

<details>
<summary><strong>📦 B2 CORS Configuration (Required)</strong></summary>

Update your bucket's CORS rules:
```json
[
  {
    "corsRuleName": "allowAll",
    "allowedOrigins": ["*"],
    "allowedHeaders": ["*"],
    "allowedOperations": ["s3_put", "s3_get", "s3_head"],
    "maxAgeSeconds": 3600
  }
]
```
</details>

### Upstash Redis (Production)

**Free tier**: 10,000 commands/day, 256 MB storage

1. Sign up at [console.upstash.com](https://console.upstash.com/)
2. Create a new Redis database
3. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

### Upstash QStash (Production - Optional)

**Free tier**: 500 messages/day

1. Go to [console.upstash.com/qstash](https://console.upstash.com/qstash)
2. Copy `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`

### Gmail SMTP (Optional - for email delivery)

1. Enable [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification)
2. Go to [App Passwords](https://myaccount.google.com/apppasswords)
3. Create a new App Password for "Mail"
4. Use the 16-character password (without spaces)

---

## 🌐 Deployment

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/handscript)

1. Click the button above or import from GitHub
2. Add all environment variables from `.env.example` (production section)
3. Deploy!

### Required Environment Variables for Production

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key |
| `B2_BUCKET_NAME` | Backblaze B2 bucket name |
| `B2_REGION` | B2 region (e.g., `us-east-005`) |
| `B2_KEY_ID` | B2 application key ID |
| `B2_APPLICATION_KEY` | B2 application key |
| `B2_ENDPOINT` | B2 S3-compatible endpoint |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token |

### Optional Variables

| Variable | Description |
|----------|-------------|
| `QSTASH_TOKEN` | For async background processing |
| `GMAIL_USER` | Gmail address for email delivery |
| `GMAIL_APP_PASSWORD` | Gmail app password |

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Next.js API    │────▶│   Gemini AI     │
│   (React)       │     │   Routes         │     │   (Transcribe)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
            ┌──────────────┐      ┌──────────────┐
            │  Redis/      │      │  B2 Storage/ │
            │  In-Memory   │      │  Local Files │
            └──────────────┘      └──────────────┘
```

### Key Components

| Directory | Purpose |
|-----------|---------|
| `app/` | Next.js App Router pages and API routes |
| `app/api/` | Backend API endpoints |
| `app/components/` | React UI components |
| `lib/` | Shared utilities and services |
| `lib/gemini.ts` | Gemini AI integration |
| `lib/s3.ts` | Storage (B2 or local filesystem) |
| `lib/redis.ts` | State (Upstash or in-memory) |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/jobs` | POST | Create new transcription job |
| `/api/jobs/[id]/status` | GET | Get job status |
| `/api/jobs/[id]/finalize` | POST | Generate final PDF |
| `/api/get-upload-url` | POST | Get presigned upload URL |
| `/api/download/[key]` | GET | Download generated PDF |

---

## 🧪 Running Tests

```bash
npm test
```

---

## 📄 License

MIT © [harrrshall](https://github.com/harrrshall)

---

<p align="center">
  Made by Harshal singh 
