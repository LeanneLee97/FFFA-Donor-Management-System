/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Heart,
  Users,
  DollarSign,
  Plus,
  Search,
  Mail,
  Phone,
  Calendar,
  Sparkles,
  TrendingUp,
  FileText,
  MessageSquare,
  Award,
  ArrowUpRight,
  CheckCircle,
  Clock,
  Send,
  X,
  UserPlus,
  RefreshCw,
  BookOpen,
  PieChart,
  Package
} from 'lucide-react';

// Imported generated images for food security (elderly and children)
import elderlyFoodImg from '/src/assets/images/happy_elderly_food_pack_1791360450602.jpg';
import childrenFoodImg from '/src/assets/images/children_food_security_1791360466884.jpg';
import familyThankYouImg from '/src/assets/images/newsletter_family_thankyou_1791359499456.jpg';

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

export default function App() {
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'donors' | 'newsletter' | 'campaigns'>('dashboard');
  const [donors, setDonors] = useState<Donor[]>([]);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showNewDonorModal, setShowNewDonorModal] = useState(false);
  const [selectedDonor, setSelectedDonor] = useState<Donor | null>(null);
  const [showDonorDetailModal, setShowDonorDetailModal] = useState(false);

  // New Donor Form state
  const [newForm, setNewForm] = useState({
    name: '',
    email: '',
    phone: '',
    category: 'New Prospect' as Donor['category'],
    initialAmount: '',
    campaign: 'SG Food Security & Elderly Nutrition Drive',
    notes: '',
    address: ''
  });

  // Newsletter & AI Generator state
  const [newsletterTheme, setNewsletterTheme] = useState('SG Food Security & Elderly Nutrition Drive');
  const [newsletterMonth, setNewsletterMonth] = useState('October 2026');
  const [aiNewsletter, setAiNewsletter] = useState<{
    subject?: string;
    greeting?: string;
    storyTitle?: string;
    storyBody?: string;
    ctaText?: string;
    adCopy?: string;
  } | null>(null);
  const [generatingNewsletter, setGeneratingNewsletter] = useState(false);

  // AI Outreach modal state
  const [showOutreachModal, setShowOutreachModal] = useState(false);
  const [outreachDonor, setOutreachDonor] = useState<Donor | null>(null);
  const [outreachTone, setOutreachTone] = useState('Warm and Heartfelt');
  const [outreachGoal, setOutreachGoal] = useState('Thank for food security support and share happy elderly & children food distribution story');
  const [aiOutreachResult, setAiOutreachResult] = useState<{ subject?: string; body?: string } | null>(null);
  const [generatingOutreach, setGeneratingOutreach] = useState(false);

  // AI Insights
  const [aiInsights, setAiInsights] = useState<{ recommendations?: { title: string; description: string; priority: string }[] } | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [donorFilterCategory, setDonorFilterCategory] = useState<string>('All');

  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      const [donorsRes, donationsRes, commsRes, campRes] = await Promise.all([
        fetch('/api/donors'),
        fetch('/api/donations'),
        fetch('/api/communications'),
        fetch('/api/campaigns')
      ]);

      const donorsData = await donorsRes.json();
      const donationsData = await donationsRes.json();
      const commsData = await commsRes.json();
      const campData = await campRes.json();

      setDonors(donorsData);
      setDonations(donationsData);
      setCommunications(commsData);
      setCampaigns(campData);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDonor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/donors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newForm)
      });
      if (res.ok) {
        setShowNewDonorModal(false);
        setNewForm({
          name: '',
          email: '',
          phone: '',
          category: 'New Prospect',
          initialAmount: '',
          campaign: 'SG Food Security & Elderly Nutrition Drive',
          notes: '',
          address: ''
        });
        fetchAllData();
      }
    } catch (err) {
      console.error('Failed to create donor:', err);
    }
  };

  const handleGenerateNewsletter = async () => {
    try {
      setGeneratingNewsletter(true);
      const res = await fetch('/api/ai/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignTitle: newsletterTheme, month: newsletterMonth })
      });
      const data = await res.json();
      setAiNewsletter(data);
    } catch (err) {
      console.error('Newsletter generation failed:', err);
    } finally {
      setGeneratingNewsletter(false);
    }
  };

  const handleGenerateOutreach = async () => {
    if (!outreachDonor) return;
    try {
      setGeneratingOutreach(true);
      const res = await fetch('/api/ai/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ donorId: outreachDonor.id, tone: outreachTone, goal: outreachGoal })
      });
      const data = await res.json();
      setAiOutreachResult(data);
    } catch (err) {
      console.error('Outreach generation failed:', err);
    } finally {
      setGeneratingOutreach(false);
    }
  };

  const handleFetchInsights = async () => {
    try {
      setLoadingInsights(true);
      const res = await fetch('/api/ai/insights', { method: 'POST' });
      const data = await res.json();
      setAiInsights(data);
    } catch (err) {
      console.error('Failed to load insights:', err);
    } finally {
      setLoadingInsights(false);
    }
  };

  const totalRaised = donations.reduce((acc, d) => acc + d.amount, 0);
  const totalDonors = donors.length;
  const recurringDonorsCount = donors.filter(d => d.category === 'Recurring' || d.category === 'Major Donor').length;
  const avgDonation = donations.length > 0 ? Math.round(totalRaised / donations.length) : 0;

  const filteredDonors = donors.filter(d => {
    const matchesSearch = d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          d.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = donorFilterCategory === 'All' || d.category === donorFilterCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-sm">
            <Heart className="w-5 h-5 fill-current" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight text-slate-900 block leading-tight">
                DonorPulse SG
              </span>
              <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded">
                🇸🇬 Food Security
              </span>
            </div>
            <span className="text-xs text-slate-500 font-medium">IPC Food Security CRM & Impact Studio</span>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setCurrentTab('dashboard')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              currentTab === 'dashboard' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setCurrentTab('donors')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              currentTab === 'donors' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Existing Donors
          </button>
          <button
            onClick={() => setCurrentTab('newsletter')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              currentTab === 'newsletter' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Newsletter & Outreach Studio
          </button>
          <button
            onClick={() => setCurrentTab('campaigns')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              currentTab === 'campaigns' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Campaigns
          </button>
        </nav>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowNewDonorModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" />
            <span>New Donors</span>
          </button>
          <button
            onClick={() => setCurrentTab('donors')}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm whitespace-nowrap"
          >
            <Users className="w-4 h-4" />
            <span>Existing Donor</span>
          </button>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-32">
            <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
          </div>
        ) : (
          <>
            {/* DASHBOARD TAB */}
            {currentTab === 'dashboard' && (
              <div className="space-y-8 animate-in fade-in duration-300">
                {/* Hero Banner with Food Security Elderly & Children Visual */}
                <div className="relative rounded-3xl overflow-hidden bg-slate-900 text-white shadow-xl">
                  <div className="absolute inset-0 z-0 opacity-45 mix-blend-overlay">
                    <img
                      src={elderlyFoodImg}
                      alt="Happy elderly receiving food"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-900/90 to-transparent z-10" />
                  <div className="relative z-20 p-8 md:p-12 max-w-2xl">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-semibold mb-4">
                      <Package className="w-3.5 h-3.5" />
                      <span>Food Security & Nutrition Initiative</span>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-4">
                      Nourishing Happy Seniors & Children Across Singapore
                    </h1>
                    <p className="text-slate-300 text-sm md:text-base mb-6 leading-relaxed">
                      Your donations directly fund weekly fresh produce, nutritious food care packs, and school breakfast meals for vulnerable elderly and children. Over S$277,000 raised this year.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => setCurrentTab('campaigns')}
                        className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm flex items-center gap-2"
                      >
                        <Package className="w-4 h-4" />
                        <span>View Food Campaigns</span>
                      </button>
                      <button
                        onClick={handleFetchInsights}
                        className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl text-xs font-semibold transition-colors flex items-center gap-2 backdrop-blur-md"
                      >
                        <Sparkles className="w-4 h-4 text-emerald-400" />
                        <span>Get AI Fundraising Insights</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* AI Insights Panel */}
                {aiInsights && aiInsights.recommendations && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 shadow-xs animate-in slide-in-from-top-4 duration-300">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2 text-emerald-900 font-semibold">
                        <Sparkles className="w-5 h-5 text-emerald-600" />
                        <span>AI Food Security Stewardship & Donor Retention Recommendations</span>
                      </div>
                      <button
                        onClick={() => setAiInsights(null)}
                        className="text-slate-400 hover:text-slate-700 text-xs font-medium"
                      >
                        Dismiss
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {aiInsights.recommendations.map((rec, idx) => (
                        <div key={idx} className="bg-white p-4 rounded-xl border border-emerald-100 shadow-xs flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-slate-900">0{idx + 1}. {rec.title}</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                rec.priority === 'High' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                              }`}>
                                {rec.priority} Priority
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 leading-relaxed">{rec.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* KPI Metrics Grid (SGD) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium text-slate-500 uppercase tracking-wider block mb-1">Total Raised YTD</span>
                      <span className="text-2xl font-bold font-mono text-slate-900">
                        S${totalRaised.toLocaleString()}
                      </span>
                      <span className="text-xs text-emerald-600 font-semibold mt-1 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> 250% tax-deductible (IPC)
                      </span>
                    </div>
                    <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                      <DollarSign className="w-6 h-6" />
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium text-slate-500 uppercase tracking-wider block mb-1">Active Donors</span>
                      <span className="text-2xl font-bold font-mono text-slate-900">
                        {totalDonors}
                      </span>
                      <span className="text-xs text-slate-500 mt-1 block">
                        {recurringDonorsCount} recurring meal sponsors
                      </span>
                    </div>
                    <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                      <Users className="w-6 h-6" />
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium text-slate-500 uppercase tracking-wider block mb-1">Food Packs Delivered</span>
                      <span className="text-2xl font-bold font-mono text-slate-900">
                        4,850 Packs
                      </span>
                      <span className="text-xs text-emerald-600 font-semibold mt-1 block">
                        Across 12 HDB estates
                      </span>
                    </div>
                    <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                      <Package className="w-6 h-6" />
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium text-slate-500 uppercase tracking-wider block mb-1">Avg Gift Size</span>
                      <span className="text-2xl font-bold font-mono text-slate-900">
                        S${avgDonation.toLocaleString()}
                      </span>
                      <span className="text-xs text-slate-500 mt-1 block">
                        Across {donations.length} food security gifts
                      </span>
                    </div>
                    <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600">
                      <PieChart className="w-6 h-6" />
                    </div>
                  </div>
                </div>

                {/* Photo Gallery of Happy Elderly & Children Receiving Food */}
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">Food Security Impact Gallery</h2>
                      <p className="text-xs text-slate-500">Real photos of happy elderly residents and children receiving nutritious food support in Singapore.</p>
                    </div>
                    <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 px-3 py-1 rounded-lg">
                      Verified Impact
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-xs group">
                      <div className="h-56 overflow-hidden">
                        <img
                          src={elderlyFoodImg}
                          alt="Happy elderly receiving food"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div className="p-4 bg-slate-900 text-white">
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block mb-1">Eldercare Nutrition Program</span>
                        <h3 className="text-sm font-bold">Happy seniors in Toa Payoh receiving weekly fresh produce and nutritional packs.</h3>
                      </div>
                    </div>

                    <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-xs group">
                      <div className="h-56 overflow-hidden">
                        <img
                          src={childrenFoodImg}
                          alt="Children receiving meals"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div className="p-4 bg-slate-900 text-white">
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block mb-1">School Breakfast Initiative</span>
                        <h3 className="text-sm font-bold">Smiling children enjoying healthy breakfast care packs before school.</h3>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recent Donations & Communications */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-base font-bold text-slate-900">Recent Food Security Donations</h2>
                      <span className="text-xs text-slate-500 font-medium">PayNow & GIRO</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            <th className="pb-3 font-semibold">Donor Name</th>
                            <th className="pb-3 font-semibold">Food Campaign</th>
                            <th className="pb-3 font-semibold text-right">Amount (SGD)</th>
                            <th className="pb-3 font-semibold text-right">Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs">
                          {donations.map((d) => (
                            <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-3.5 font-semibold text-slate-900">{d.donorName}</td>
                              <td className="py-3.5 text-slate-600">{d.campaign}</td>
                              <td className="py-3.5 text-right font-mono font-bold text-emerald-700">
                                +S${d.amount.toLocaleString()}
                              </td>
                              <td className="py-3.5 text-right font-mono text-slate-500">{d.date}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-6">
                        <h2 className="text-base font-bold text-slate-900">Communication History</h2>
                        <MessageSquare className="w-4 h-4 text-slate-400" />
                      </div>
                      <div className="space-y-4">
                        {communications.map((c) => (
                          <div key={c.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-slate-900">{c.donorName}</span>
                              <span className="text-[10px] font-medium text-slate-400 font-mono">{c.date}</span>
                            </div>
                            <p className="text-xs text-slate-600 line-clamp-2">{c.summary}</p>
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                                {c.type}
                              </span>
                              <span className="text-[10px] font-medium text-slate-500">
                                Sentiment: {c.sentiment}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => setCurrentTab('donors')}
                      className="mt-6 w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors text-center"
                    >
                      View All Donors & Logs
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* EXISTING DONORS TAB */}
            {currentTab === 'donors' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">Existing Donors Directory</h1>
                    <p className="text-xs text-slate-500 mt-1">Manage Singapore food security donors, UEN corporate sponsors, and AI meal outreach.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowNewDonorModal(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>Add New Donor</span>
                    </button>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="relative w-full md:w-96">
                    <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search donors by name or email..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
                    {['All', 'Major Donor', 'Recurring', 'First-Time', 'Board', 'New Prospect'].map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setDonorFilterCategory(cat)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                          donorFilterCategory === cat ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-wider">
                        <th className="p-4">Donor / Corporate Name</th>
                        <th className="p-4">Category</th>
                        <th className="p-4">Contact</th>
                        <th className="p-4 text-right">Lifetime Donated (SGD)</th>
                        <th className="p-4 text-right">Last Gift</th>
                        <th className="p-4 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredDonors.map((donor) => (
                        <tr key={donor.id} className="hover:bg-slate-50/75 transition-colors">
                          <td className="p-4">
                            <div className="font-bold text-slate-900 text-sm">{donor.name}</div>
                            <div className="text-slate-500 text-[11px]">{donor.address}</div>
                          </td>
                          <td className="p-4">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold ${
                              donor.category === 'Major Donor' ? 'bg-purple-100 text-purple-800' :
                              donor.category === 'Recurring' ? 'bg-emerald-100 text-emerald-800' :
                              donor.category === 'Board' ? 'bg-blue-100 text-blue-800' :
                              donor.category === 'First-Time' ? 'bg-amber-100 text-amber-800' :
                              'bg-slate-100 text-slate-800'
                            }`}>
                              {donor.category}
                            </span>
                          </td>
                          <td className="p-4">
                            <div className="text-slate-900">{donor.email}</div>
                            <div className="text-slate-500 text-[11px] font-mono">{donor.phone}</div>
                          </td>
                          <td className="p-4 text-right font-mono font-bold text-emerald-700 text-sm">
                            S${donor.totalDonated.toLocaleString()}
                          </td>
                          <td className="p-4 text-right font-mono text-slate-600">
                            {donor.lastDonationDate}
                          </td>
                          <td className="p-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => {
                                  setSelectedDonor(donor);
                                  setShowDonorDetailModal(true);
                                }}
                                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-colors"
                              >
                                View History
                              </button>
                              <button
                                onClick={() => {
                                  setOutreachDonor(donor);
                                  setShowOutreachModal(true);
                                  setAiOutreachResult(null);
                                }}
                                className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded-lg transition-colors flex items-center gap-1"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>AI Outreach</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* NEWSLETTER & OUTREACH STUDIO TAB */}
            {currentTab === 'newsletter' && (
              <div className="space-y-8 animate-in fade-in duration-300">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">Newsletter & Food Security Outreach Studio</h1>
                    <p className="text-xs text-slate-500 mt-1">Generate food security impact newsletters with photos of happy elderly residents and children receiving meals.</p>
                  </div>
                  <button
                    onClick={handleGenerateNewsletter}
                    disabled={generatingNewsletter}
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
                  >
                    {generatingNewsletter ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    <span>Generate AI Newsletter & Food Ads</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                    <h2 className="text-base font-bold text-slate-900 mb-2">Campaign Settings</h2>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Campaign Theme</label>
                      <input
                        type="text"
                        value={newsletterTheme}
                        onChange={(e) => setNewsletterTheme(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Edition Month</label>
                      <input
                        type="text"
                        value={newsletterMonth}
                        onChange={(e) => setNewsletterMonth(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div className="pt-4 border-t border-slate-100">
                      <h3 className="text-xs font-bold text-slate-900 mb-2">Impact Visuals (Elderly & Children)</h3>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="rounded-xl overflow-hidden border border-slate-200 shadow-xs">
                          <img
                            src={elderlyFoodImg}
                            alt="Elderly receiving food"
                            className="w-full h-24 object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="rounded-xl overflow-hidden border border-slate-200 shadow-xs">
                          <img
                            src={childrenFoodImg}
                            alt="Children receiving meals"
                            className="w-full h-24 object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Photos of happy elderly residents and children receiving food care packs for donor newsletters.
                      </p>
                    </div>
                  </div>

                  <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-8 shadow-xs space-y-6">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                      <div>
                        <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">DonorPulse SG · Food Security Edition</span>
                        <h3 className="text-xl font-bold text-slate-900">{aiNewsletter?.subject || `${newsletterMonth}: ${newsletterTheme}`}</h3>
                      </div>
                      <span className="text-xs text-slate-400 font-mono">{newsletterMonth}</span>
                    </div>

                    {aiNewsletter ? (
                      <div className="space-y-6 animate-in fade-in duration-300">
                        <div className="text-slate-700 text-xs italic font-medium">
                          "{aiNewsletter.greeting}"
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
                            <img
                              src={elderlyFoodImg}
                              alt="Happy elderly"
                              className="w-full h-44 object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <div className="p-3 bg-slate-900 text-white">
                              <span className="text-[10px] font-bold text-emerald-400 block">Seniors Nutrition</span>
                              <h4 className="text-xs font-bold">Happy elderly residents receiving fresh packs</h4>
                            </div>
                          </div>
                          <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
                            <img
                              src={childrenFoodImg}
                              alt="Happy children"
                              className="w-full h-44 object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <div className="p-3 bg-slate-900 text-white">
                              <span className="text-[10px] font-bold text-emerald-400 block">School Breakfast</span>
                              <h4 className="text-xs font-bold">Smiling children enjoying wholesome meals</h4>
                            </div>
                          </div>
                        </div>

                        <div className="text-xs text-slate-700 leading-relaxed space-y-3 whitespace-pre-line">
                          {aiNewsletter.storyBody}
                        </div>

                        <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 flex items-center justify-between">
                          <div>
                            <span className="text-xs font-bold text-emerald-900 block">Food Security CTA</span>
                            <p className="text-xs text-emerald-700">{aiNewsletter.ctaText}</p>
                          </div>
                          <button
                            onClick={() => alert('Food security newsletter broadcast sent to all Singapore donors!')}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm"
                          >
                            Send Broadcast
                          </button>
                        </div>

                        <div className="pt-4 border-t border-slate-100">
                          <span className="text-xs font-bold text-slate-900 block mb-2">Social Media & WhatsApp Ad Copy for Meal Sponsorship</span>
                          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 font-mono">
                            {aiNewsletter.adCopy}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-20 text-slate-400">
                        <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
                        <p className="text-sm font-medium">Click "Generate AI Newsletter & Food Ads" to create your campaign.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* CAMPAIGNS TAB */}
            {currentTab === 'campaigns' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">Campaigns</h1>
                    <p className="text-xs text-slate-500 mt-1">Manage Singapore food security campaigns, eldercare nutrition goals, and school breakfast funding.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {campaigns.map((cmp) => {
                    const percent = Math.min(100, Math.round((cmp.raised / cmp.goal) * 100));
                    return (
                      <div key={cmp.id} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-md ${
                              cmp.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                              {cmp.status}
                            </span>
                            <span className="text-xs font-mono text-slate-400">{cmp.startDate}</span>
                          </div>
                          <h3 className="text-base font-bold text-slate-900 mb-2">{cmp.title}</h3>
                          <p className="text-xs text-slate-600 mb-6 leading-relaxed">{cmp.description}</p>
                          <div className="mb-4 rounded-xl overflow-hidden border border-slate-200">
                            <img
                              src={cmp.id === 'cmp2' ? childrenFoodImg : elderlyFoodImg}
                              alt="Food distribution impact"
                              className="w-full h-32 object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-xs font-mono font-bold mb-2">
                            <span className="text-emerald-700">S${cmp.raised.toLocaleString()} raised</span>
                            <span className="text-slate-400">Goal: S${cmp.goal.toLocaleString()}</span>
                          </div>
                          <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                            <div className="bg-emerald-600 h-full rounded-full transition-all duration-500" style={{ width: `${percent}%` }} />
                          </div>
                          <div className="mt-4 flex items-center justify-between text-xs">
                            <span className="text-slate-500 font-medium">{percent}% funded</span>
                            <button
                              onClick={() => setCurrentTab('newsletter')}
                              className="text-emerald-600 font-semibold hover:underline"
                            >
                              Create Campaign Ad &rarr;
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* NEW DONOR MODAL */}
      {showNewDonorModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Add New Food Security Donor / Sponsor</h2>
                <p className="text-xs text-slate-500">Record a new donor profile or corporate meal sponsor.</p>
              </div>
              <button
                onClick={() => setShowNewDonorModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateDonor} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Donor / Company Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. NTUC FairPrice Foundation / Dr. Alan Koh"
                  value={newForm.name}
                  onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="alan.koh@example.sg"
                    value={newForm.email}
                    onChange={(e) => setNewForm({ ...newForm, email: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Singapore Phone</label>
                  <input
                    type="text"
                    placeholder="+65 9123 4567"
                    value={newForm.phone}
                    onChange={(e) => setNewForm({ ...newForm, phone: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Donor Tier / Category</label>
                  <select
                    value={newForm.category}
                    onChange={(e) => setNewForm({ ...newForm, category: e.target.value as Donor['category'] })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="New Prospect">New Prospect</option>
                    <option value="First-Time">First-Time Donor</option>
                    <option value="Recurring">Recurring Sustainer</option>
                    <option value="Major Donor">Major Donor</option>
                    <option value="Board">Board Member</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Initial Gift (SGD)</label>
                  <input
                    type="number"
                    placeholder="e.g. 5000"
                    value={newForm.initialAmount}
                    onChange={(e) => setNewForm({ ...newForm, initialAmount: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Singapore Address</label>
                <input
                  type="text"
                  placeholder="10 Collyer Quay, Singapore 049315"
                  value={newForm.address}
                  onChange={(e) => setNewForm({ ...newForm, address: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Stewardship Notes & Meal Sponsorship Preferences</label>
                <textarea
                  rows={3}
                  placeholder="Sponsoring 50 elderly food care packs monthly, requests 250% tax deduction receipt..."
                  value={newForm.notes}
                  onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowNewDonorModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
                >
                  Save Donor Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DONOR DETAIL MODAL */}
      {showDonorDetailModal && selectedDonor && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-8 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{selectedDonor.name}</h2>
                <p className="text-xs text-slate-500">{selectedDonor.category} · {selectedDonor.email}</p>
              </div>
              <button
                onClick={() => setShowDonorDetailModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="text-[11px] font-medium text-slate-500 block mb-1">Lifetime Donated</span>
                  <span className="text-lg font-bold font-mono text-emerald-700">S${selectedDonor.totalDonated.toLocaleString()}</span>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="text-[11px] font-medium text-slate-500 block mb-1">Last Gift Date</span>
                  <span className="text-sm font-bold font-mono text-slate-900">{selectedDonor.lastDonationDate}</span>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="text-[11px] font-medium text-slate-500 block mb-1">Last Contact</span>
                  <span className="text-sm font-bold font-mono text-slate-900">{selectedDonor.lastContactDate}</span>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Donor Notes & Singapore Tax Receipt Info</h3>
                <p className="text-xs text-slate-600 bg-slate-50 p-4 rounded-xl border border-slate-200 leading-relaxed">
                  {selectedDonor.notes || 'No notes recorded for this donor yet.'}
                </p>
              </div>

              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Giving History for {selectedDonor.name}</h3>
                <div className="space-y-2">
                  {donations.filter(d => d.donorId === selectedDonor.id).length > 0 ? (
                    donations.filter(d => d.donorId === selectedDonor.id).map(d => (
                      <div key={d.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                        <div>
                          <span className="font-bold text-slate-900 block">{d.campaign}</span>
                          <span className="text-slate-500 font-mono">Paid via {d.paymentMethod}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-bold font-mono text-emerald-700">+S${d.amount.toLocaleString()}</span>
                          <span className="block text-[10px] text-slate-400 font-mono">{d.date}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400 italic">No recorded donations found for this profile.</p>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setShowDonorDetailModal(false);
                    setOutreachDonor(selectedDonor);
                    setShowOutreachModal(true);
                    setAiOutreachResult(null);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Generate AI Outreach Message</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI OUTREACH MODAL */}
      {showOutreachModal && outreachDonor && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-8 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-emerald-600" />
                  <span>AI Personalized Outreach for {outreachDonor.name}</span>
                </h2>
                <p className="text-xs text-slate-500">Food security impact updates and happy elderly/children story sharing.</p>
              </div>
              <button
                onClick={() => setShowOutreachModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tone</label>
                  <select
                    value={outreachTone}
                    onChange={(e) => setOutreachTone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="Warm and Heartfelt">Warm and Heartfelt</option>
                    <option value="Professional and Impact-Oriented">Professional & Impact-Oriented</option>
                    <option value="Enthusiastic and Grateful">Enthusiastic & Grateful</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Key Message Goal</label>
                  <input
                    type="text"
                    value={outreachGoal}
                    onChange={(e) => setOutreachGoal(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <button
                onClick={handleGenerateOutreach}
                disabled={generatingOutreach}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {generatingOutreach ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>Generate Personalized Message</span>
              </button>

              {aiOutreachResult && (
                <div className="mt-6 p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 animate-in fade-in duration-300">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Subject Line</span>
                    <div className="text-xs font-bold text-slate-900">{aiOutreachResult.subject}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Email Body</span>
                    <div className="text-xs text-slate-700 whitespace-pre-line leading-relaxed bg-white p-4 rounded-xl border border-slate-200">
                      {aiOutreachResult.body}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`Subject: ${aiOutreachResult.subject}\n\n${aiOutreachResult.body}`);
                        alert('Copied outreach message to clipboard!');
                      }}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold"
                    >
                      Copy to Clipboard
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
