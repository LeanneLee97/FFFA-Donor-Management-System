import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || 'dummy-key',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

interface Donor {
  id: string;
  name: string;
  email: string;
  phone: string;
  category: 'New Prospect' | 'First-Time' | 'Recurring' | 'Major Donor' | 'Board';
  totalDonated: number;
  lastDonationDate: string;
  lastContactDate: string;
  notes: string;
  address: string;
}

interface Donation {
  id: string;
  donorId: string;
  donorName: string;
  amount: number;
  date: string;
  campaign: string;
  paymentMethod: string;
}

interface Communication {
  id: string;
  donorId: string;
  donorName: string;
  type: 'Email' | 'Phone Call' | 'Meeting' | 'Newsletter' | 'Thank You Card';
  date: string;
  summary: string;
  sentiment: 'Warm' | 'Neutral' | 'Enthusiastic';
}

interface Campaign {
  id: string;
  title: string;
  goal: number;
  raised: number;
  status: 'Active' | 'Upcoming' | 'Completed';
  startDate: string;
  endDate: string;
  description: string;
}

let donors: Donor[] = [
  {
    id: 'd1',
    name: 'Dato’ Seri Tan Kok Leong',
    email: 'tan.kokleong@keppel-holdings.sg',
    phone: '+65 9123 4567',
    category: 'Major Donor',
    totalDonated: 35000,
    lastDonationDate: '2026-09-15',
    lastContactDate: '2026-09-20',
    notes: 'Key supporter of Heartland Food Security & Elderly Nutrition packs across Toa Payoh and Ang Mo Kio.',
    address: '15 Nassim Road, Singapore 258380'
  },
  {
    id: 'd2',
    name: 'Dr. Priya Sharma',
    email: 'priya.sharma@duke-nus.edu.sg',
    phone: '+65 8234 5678',
    category: 'Recurring',
    totalDonated: 7200,
    lastDonationDate: '2026-10-01',
    lastContactDate: '2026-10-02',
    notes: 'Monthly sustaining donor ($600/mo) dedicated to school children breakfast nutrition.',
    address: '8 Shenton Way, Singapore 068811'
  },
  {
    id: 'd3',
    name: 'Marcus & Rachel Lim',
    email: 'lim.family@dbs-wealth.sg',
    phone: '+65 9345 6789',
    category: 'First-Time',
    totalDonated: 1500,
    lastDonationDate: '2026-10-04',
    lastContactDate: '2026-10-05',
    notes: 'Contributed to the fresh produce distribution drive. Sent personalized family thank-you card.',
    address: '45 Bukit Timah Road, Singapore 229832'
  },
  {
    id: 'd4',
    name: 'Mr. Kenneth Ng, PBM',
    email: 'kenneth.ng@singapore-capital.com',
    phone: '+65 9456 7890',
    category: 'Board',
    totalDonated: 50000,
    lastDonationDate: '2026-08-10',
    lastContactDate: '2026-09-28',
    notes: 'Board Member & Chairman of Food Security Logistics Committee.',
    address: '1 Temasek Avenue, #32-01 Millenia Tower, Singapore 039192'
  },
  {
    id: 'd5',
    name: 'Serena Koh',
    email: 'serena.koh@temasek-counsel.sg',
    phone: '+65 9567 8901',
    category: 'New Prospect',
    totalDonated: 0,
    lastDonationDate: 'N/A',
    lastContactDate: '2026-10-06',
    notes: 'Interested in sponsoring monthly fresh vegetable packs for vulnerable elderly households.',
    address: '9 Scotts Road, Singapore 228210'
  }
];

let donations: Donation[] = [
  { id: 'dn1', donorId: 'd1', donorName: 'Dato’ Seri Tan Kok Leong', amount: 15000, date: '2026-09-15', campaign: 'SG Food Security & Elderly Nutrition Drive', paymentMethod: 'GIRO Transfer' },
  { id: 'dn2', donorId: 'd2', donorName: 'Dr. Priya Sharma', amount: 600, date: '2026-10-01', campaign: 'School Children Breakfast Fund', paymentMethod: 'PayNow' },
  { id: 'dn3', donorId: 'd3', donorName: 'Marcus & Rachel Lim', amount: 1500, date: '2026-10-04', campaign: 'Heartland Fresh Produce Distribution', paymentMethod: 'Credit Card' },
  { id: 'dn4', donorId: 'd4', donorName: 'Mr. Kenneth Ng, PBM', amount: 25000, date: '2026-08-10', campaign: 'SG Food Security & Elderly Nutrition Drive', paymentMethod: 'Bank Transfer' }
];

let communications: Communication[] = [
  { id: 'c1', donorId: 'd3', donorName: 'Marcus & Rachel Lim', type: 'Thank You Card', date: '2026-10-05', summary: 'Sent personalized photo card featuring happy elderly residents receiving nutritious food care packs.', sentiment: 'Enthusiastic' },
  { id: 'c2', donorId: 'd1', donorName: 'Dato’ Seri Tan Kok Leong', type: 'Meeting', date: '2026-09-20', summary: 'Discussed expansion of weekly food distribution centers in Bedok and Tampines.', sentiment: 'Warm' },
  { id: 'c3', donorId: 'd2', donorName: 'Dr. Priya Sharma', type: 'Email', date: '2026-10-02', summary: 'Sent impact report showing 320 school children receiving daily nutritious breakfast packs.', sentiment: 'Enthusiastic' }
];

let campaigns: Campaign[] = [
  { id: 'cmp1', title: 'SG Food Security & Elderly Nutrition Drive', goal: 200000, raised: 145000, status: 'Active', startDate: '2026-10-01', endDate: '2026-12-31', description: 'Providing weekly nutritious food care packs, fresh vegetables, and essential groceries to vulnerable elderly households across Singapore HDB estates.' },
  { id: 'cmp2', title: 'School Children Breakfast & Nutrition Fund', goal: 120000, raised: 98000, status: 'Active', startDate: '2026-01-01', endDate: '2026-12-31', description: 'Ensuring low-income school children receive balanced daily breakfasts and wholesome after-school meals for optimal health and learning.' },
  { id: 'cmp3', title: 'Heartland Fresh Produce Distribution', goal: 80000, raised: 34000, status: 'Upcoming', startDate: '2026-11-01', endDate: '2026-12-15', description: 'Partnering with local markets to deliver fresh farm-to-door vegetables and provisions to frail seniors living alone.' }
];

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  app.get('/api/donors', (req, res) => {
    res.json(donors);
  });

  app.post('/api/donors', (req, res) => {
    const newDonor: Donor = {
      id: 'd_' + Date.now(),
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      category: req.body.category || 'New Prospect',
      totalDonated: Number(req.body.initialAmount) || 0,
      lastDonationDate: Number(req.body.initialAmount) > 0 ? new Date().toISOString().split('T')[0] : 'N/A',
      lastContactDate: new Date().toISOString().split('T')[0],
      notes: req.body.notes || '',
      address: req.body.address || ''
    };

    donors.unshift(newDonor);

    if (newDonor.totalDonated > 0) {
      const newDonation: Donation = {
        id: 'dn_' + Date.now(),
        donorId: newDonor.id,
        donorName: newDonor.name,
        amount: newDonor.totalDonated,
        date: new Date().toISOString().split('T')[0],
        campaign: req.body.campaign || 'SG Food Security & Elderly Nutrition Drive',
        paymentMethod: req.body.paymentMethod || 'PayNow'
      };
      donations.unshift(newDonation);
    }

    communications.unshift({
      id: 'c_' + Date.now(),
      donorId: newDonor.id,
      donorName: newDonor.name,
      type: 'Email',
      date: new Date().toISOString().split('T')[0],
      summary: `Onboarded new food security donor profile with category: ${newDonor.category}`,
      sentiment: 'Warm'
    });

    res.status(201).json(newDonor);
  });

  app.get('/api/donations', (req, res) => {
    res.json(donations);
  });

  app.post('/api/donations', (req, res) => {
    const { donorId, amount, campaign, paymentMethod } = req.body;
    const donor = donors.find(d => d.id === donorId);
    if (!donor) {
      return res.status(404).json({ error: 'Donor not found' });
    }

    const donation: Donation = {
      id: 'dn_' + Date.now(),
      donorId,
      donorName: donor.name,
      amount: Number(amount),
      date: new Date().toISOString().split('T')[0],
      campaign: campaign || 'SG Food Security & Elderly Nutrition Drive',
      paymentMethod: paymentMethod || 'PayNow'
    };

    donations.unshift(donation);
    donor.totalDonated += donation.amount;
    donor.lastDonationDate = donation.date;

    res.status(201).json(donation);
  });

  app.get('/api/communications', (req, res) => {
    res.json(communications);
  });

  app.post('/api/communications', (req, res) => {
    const { donorId, type, summary, sentiment } = req.body;
    const donor = donors.find(d => d.id === donorId);
    if (!donor) {
      return res.status(404).json({ error: 'Donor not found' });
    }

    const comm: Communication = {
      id: 'c_' + Date.now(),
      donorId,
      donorName: donor.name,
      type: type || 'Email',
      date: new Date().toISOString().split('T')[0],
      summary,
      sentiment: sentiment || 'Warm'
    };

    communications.unshift(comm);
    donor.lastContactDate = comm.date;

    res.status(201).json(comm);
  });

  app.get('/api/campaigns', (req, res) => {
    res.json(campaigns);
  });

  app.post('/api/ai/outreach', async (req, res) => {
    try {
      const { donorId, tone, goal } = req.body;
      const donor = donors.find(d => d.id === donorId);
      if (!donor) {
        return res.status(404).json({ error: 'Donor not found' });
      }

      const prompt = `Write a personalized, heartfelt donor outreach message for ${donor.name} regarding food security in Singapore.
Donor details:
- Category: ${donor.category}
- Total Donated: S$${donor.totalDonated}
- Last Donation: ${donor.lastDonationDate}
- Notes: ${donor.notes}

Desired Tone: ${tone || 'Warm, appreciative, and focused on food security impact for elderly and children'}
Goal of message: ${goal || 'Thank them for supporting our food security drive and share a heartwarming story of happy elderly residents and children receiving food care packs'}

Return a JSON object with two fields:
1. "subject": Email subject line
2. "body": Full email body text with placeholders where appropriate.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          systemInstruction: 'You are an expert Singapore non-profit development director specializing in food security, eldercare nutrition, and donor stewardship.'
        }
      });

      const text = response.text || '{}';
      const result = JSON.parse(text);
      res.json(result);
    } catch (err: any) {
      console.error('AI Outreach Error:', err);
      res.status(500).json({ error: err.message || 'Failed to generate AI outreach' });
    }
  });

  app.post('/api/ai/newsletter', async (req, res) => {
    try {
      const { campaignTitle, month, theme } = req.body;

      const prompt = `Create a monthly impact newsletter for donors supporting our Singapore food security initiative.
Campaign/Theme: ${campaignTitle || 'SG Food Security & Elderly Nutrition Drive'} (${theme || 'Meals and Nutrition for Seniors & Children'})
Month: ${month || 'October 2026'}

Include:
1. Catchy Newsletter Subject Line
2. Warm opening note from the Director
3. Featured impact story highlighting happy elderly residents and smiling children receiving nutritious food care packs
4. Upcoming food distribution dates / call to action
5. Social media ad copy for food security donor acquisition

Return a JSON object with fields: "subject", "greeting", "storyTitle", "storyBody", "ctaText", "adCopy".`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          systemInstruction: 'You are an inspiring Singapore non-profit communications director.'
        }
      });

      const text = response.text || '{}';
      const result = JSON.parse(text);
      res.json(result);
    } catch (err: any) {
      console.error('AI Newsletter Error:', err);
      res.status(500).json({ error: err.message || 'Failed to generate AI newsletter' });
    }
  });

  app.post('/api/ai/insights', async (req, res) => {
    try {
      const totalRaised = donations.reduce((acc, d) => acc + d.amount, 0);
      const activeDonorsCount = donors.length;

      const prompt = `Analyze our Singapore food security donor database and provide 3 actionable fundraising and donor retention recommendations (e.g. recurring PayNow meal sponsorship, corporate food drives, 250% tax deductions).
Total Donors: ${activeDonorsCount}
Total Raised: S$${totalRaised}
Donors breakdown: ${JSON.stringify(donors.map(d => ({ name: d.name, category: d.category, total: d.totalDonated })))}

Return a JSON object with an array "recommendations", where each recommendation has "title", "description", and "priority" ('High', 'Medium', 'Low').`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          systemInstruction: 'You are a senior Singapore non-profit fundraising strategist.'
        }
      });

      const text = response.text || '{}';
      const result = JSON.parse(text);
      res.json(result);
    } catch (err: any) {
      console.error('AI Insights Error:', err);
      res.status(500).json({ error: err.message || 'Failed to generate insights' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`DonorPulse SG Food Security server running on port ${PORT}`);
  });
}

startServer();
