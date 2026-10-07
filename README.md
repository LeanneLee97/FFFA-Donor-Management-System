# DonorPulse CRM · FFFA Donor Management System 🇸🇬

> **Comprehensive Donor Relationship Management (CRM), Food Security Impact Dashboard, and AI-Powered Outreach & Newsletter Studio.**

[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-purple.svg)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-v4-38bdf8.svg)](https://tailwindcss.com/)
[![Google Gemini API](https://img.shields.io/badge/Google%20Gemini-3.8%20Flash-4285F4.svg)](https://ai.google.dev/)
[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg)](LICENSE)

---

## 📌 Overview

**DonorPulse CRM** is a purpose-built donor relationship management and stewardship platform tailored for non-profit organizations and Institutions of a Public Character (IPC) in Singapore dedicated to food security. Specifically built to support community meal distribution, eldercare nutrition packs, and school breakfast initiatives (such as Free Food For All / FFFA campaigns).

The platform pairs donor management workflows with **Google Gemini 3.8 Flash** AI capabilities—enabling non-profit teams to generate tailored donor communications, draft monthly impact newsletters, analyze donor retention strategies, and track Singapore 250% tax-deductible giving.

---

## ✨ Key Features

### 1. 📊 Executive Impact & KPI Dashboard
- **Real-Time Giving Metrics**: Track Year-to-Date funds raised (SGD), active donor count, average gift size, and recurring donor retention.
- **Verified Impact Counter**: Displays delivered food care packs and beneficiary counts across Singapore HDB estates.
- **Recent Gifts & Payment Channels**: Logs transactions across PayNow, GIRO, Bank Transfer, and Credit Cards with 250% IPC tax deduction tags.
- **Touchpoint History & Sentiment**: Monitors multi-channel donor interactions (Email, Meetings, Phone Calls, Thank-You cards) with tracked sentiment.
- **Impact Visual Gallery**: Authentic photo highlights featuring eldercare nutrition programs and school breakfast care pack distributions.

### 2. 👥 Donor Directory & Relationship Management
- **Tier Categorization**: Segment donors into *Major Donor*, *Recurring Sustainer*, *First-Time*, *Board*, and *New Prospect*.
- **Search & Filters**: Instant full-text search across donor names, emails, and giving tiers.
- **Detailed Profiles**: Full view of lifetime contributions, last donation dates, Singapore mailing addresses, and stewardship notes.
- **Interaction Logging**: Track giving history per profile with automated communication records upon onboarding.

### 3. 🤖 AI-Powered Outreach Assistant
- **Context-Aware Drafting**: Uses `@google/genai` with `gemini-3.8-flash` to craft personalized stewardship emails tailored to each donor's category, giving history, and stewardship preferences.
- **Configurable Tone & Purpose**: Switch between *Warm & Heartfelt*, *Professional & Impact-Oriented*, and *Enthusiastic & Grateful*.
- **One-Click Clipboard Export**: Ready-to-send email subject lines and body copy.

### 4. 📰 Newsletter & Food Outreach Studio
- **Monthly Impact Editions**: Automated newsletter generator synthesizing campaign themes, monthly milestones, and heartwarming recipient stories.
- **Social & Messaging Ad Copy**: Ready-to-publish WhatsApp broadcast copy and social media captions targeted at donor acquisition and meal sponsorships.
- **Direct Broadcast Simulation**: Send prepared newsletters to all active community donors.

### 5. 🎯 Food Security Campaign Tracking
- **Multi-Campaign Monitoring**: Track funding progress for specific initiatives like *SG Food Security & Elderly Nutrition Drive*, *School Children Breakfast & Nutrition Fund*, and *Heartland Fresh Produce Distribution*.
- **Goal Progress Bars**: Visual completion percentage, active vs. upcoming indicators, and timeline management.

### 6. 💡 AI Strategic Fundraising & Retention Insights
- **Heuristic & Data Analysis**: Generates high-priority fundraising recommendations (e.g., PayNow QR monthly sponsorship drives, corporate UEN matching, and tax deduction reminders) based on current donor breakdown and gift sizes.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS v4](https://tailwindcss.com/), [Lucide React](https://lucide.dev/), [Motion](https://motion.dev/) |
| **Backend** | [Node.js](https://nodejs.org/) & [Express 4](https://expressjs.com/), [tsx](https://github.com/privatenumber/tsx) |
| **AI / LLM** | [Google Gemini 3.8 Flash](https://ai.google.dev/) via official `@google/genai` SDK |
| **Build & Dev Tooling** | [Vite 8](https://vitejs.dev/), `@tailwindcss/vite`, `@vitejs/plugin-react` |

---

## 📂 Repository Structure

```
FFFA-Donor-Management-System/
├── src/
│   ├── assets/
│   │   └── images/                     # Impact images (elderly nutrition, children meals, etc.)
│   ├── App.tsx                         # Main SPA component containing all CRM views & modals
│   ├── index.css                       # Tailwind CSS v4 styling entrypoint
│   └── main.tsx                        # React DOM root initialization
├── .env.example                        # Example environment variables
├── .gitignore                          # Git ignore definitions
├── index.html                          # Single-page HTML shell with Google Fonts
├── metadata.json                       # AI Studio app metadata
├── package.json                        # NPM package configuration & scripts
├── server.ts                           # Express server, Vite middleware & Gemini API routes
├── tsconfig.json                       # TypeScript compiler configuration
└── vite.config.ts                      # Vite configuration with Tailwind & React plugins
```

---

## 🔌 API Endpoints

The Express server in `server.ts` handles REST API endpoints and integrates with Google Gemini:

### Donor & Transaction Endpoints
- `GET /api/donors` — Retrieve all donor records.
- `POST /api/donors` — Create a new donor profile and optional initial donation record.
- `GET /api/donations` — Retrieve all donation transactions.
- `POST /api/donations` — Record a donation against an existing donor.
- `GET /api/communications` — Fetch communication and touchpoint history.
- `POST /api/communications` — Log an interaction with sentiment.
- `GET /api/campaigns` — Fetch all food security campaigns.

### Gemini AI Endpoints
- `POST /api/ai/outreach` — Generates personalized donor outreach messages based on donor giving history and tone.
- `POST /api/ai/newsletter` — Generates a monthly impact newsletter and social ad copy.
- `POST /api/ai/insights` — Generates 3 strategic fundraising and donor retention recommendations.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: Version 18.x or higher (Node 20+ recommended)
- **NPM**: Version 9.x or higher
- **Gemini API Key**: A valid Google Gemini API key from [Google AI Studio](https://aistudio.google.com/)

### 1. Clone the Repository
```bash
git clone https://github.com/LeanneLee97/FFFA-Donor-Management-System.git
cd FFFA-Donor-Management-System
```

### 2. Configure Environment Variables
Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Populate `.env` with your API credentials:
```env
# Google Gemini API key for AI Studio features
GEMINI_API_KEY="your-gemini-api-key-here"

# (Optional) Application port (defaults to 3000)
PORT=3000

# (Optional) Hosting URL
APP_URL="http://localhost:3000"
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Run the Development Server
```bash
npm run dev
```

The Express server will start up with Vite integrated in middleware mode:
```
DonorPulse SG Food Security server running on port 3000
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📦 Production Build

To build the client bundle for production:

```bash
# Compile client assets into dist/ and typecheck
npm run build

# Start the production Node server
npm run start
```

---

## 🇸🇬 Singapore Non-Profit & IPC Notes

- **250% Tax Deduction**: Singapore IPC donations are eligible for a 2.5x tax deduction against statutory taxable income.
- **Local Payment Channels**: Built with preset support for **PayNow** (UEN-based instantaneous transfer) and **GIRO** (for recurring monthly meal pledges).

---

## 📄 License

This project is licensed under the [Apache-2.0 License](LICENSE).
