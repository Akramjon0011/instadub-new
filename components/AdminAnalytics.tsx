import React, { useMemo } from 'react';
import { UserData } from '../types';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';

export const AdminAnalytics: React.FC<{ users: UserData[] }> = ({ users }) => {
  const stats = useMemo(() => {
    let proCount = 0;
    let creatorCount = 0;
    let freeCount = 0;

    // Kunlik registratsiyalarni hisoblash
    const dailySignups: Record<string, number> = {};

    users.forEach(u => {
      // Reja bo'yicha hisoblash
      if (u.plan === 'pro') proCount++;
      else if (u.plan === 'creator') creatorCount++;
      else freeCount++;

      // Sanani aniqlash
      let dateKey = 'Noma\'lum';
      if (u.createdAt) {
        try {
          // Firestore timestamp format
          const d = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
          dateKey = d.toISOString().split('T')[0];
        } catch(e) {
          // xato bo'lsa
        }
      }

      if (!dailySignups[dateKey]) dailySignups[dateKey] = 0;
      dailySignups[dateKey]++;
    });

    // Jami tushum
    const totalRevenue = (proCount * 130000) + (creatorCount * 390000);
    // Konversiya yuzasi
    const totalUsers = users.length || 1;
    const conversionRate = (((proCount + creatorCount) / totalUsers) * 100).toFixed(1);

    // Grafik uchun formatlash
    const signupData = Object.keys(dailySignups)
      .sort((a,b) => a.localeCompare(b))
      .map(key => ({
        date: key,
        count: dailySignups[key]
      }));

    return { totalRevenue, conversionRate, signupData, totalUsers, proCount, creatorCount };
  }, [users]);

  return (
    <div className="mb-8 space-y-6">
      {/* 4 ta asosiy blok */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-700 p-4 rounded-xl shadow-lg">
          <p className="text-gray-400 text-sm font-medium mb-1">Jami Foydalanuvchilar</p>
          <p className="text-2xl font-bold text-white">{stats.totalUsers}</p>
        </div>
        <div className="bg-gray-900 border border-gray-700 p-4 rounded-xl shadow-lg">
          <p className="text-gray-400 text-sm font-medium mb-1">Jami Tushum</p>
          <p className="text-2xl font-bold text-green-400">{stats.totalRevenue.toLocaleString()} so'm</p>
        </div>
        <div className="bg-gray-900 border border-gray-700 p-4 rounded-xl shadow-lg">
          <p className="text-gray-400 text-sm font-medium mb-1">Pro / Creator</p>
          <p className="text-2xl font-bold text-blue-400">{stats.proCount} / {stats.creatorCount}</p>
        </div>
        <div className="bg-gray-900 border border-gray-700 p-4 rounded-xl shadow-lg">
          <p className="text-gray-400 text-sm font-medium mb-1">Konversiya (To'laganlar)</p>
          <p className="text-2xl font-bold text-purple-400">{stats.conversionRate}%</p>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-700 p-4 rounded-xl shadow-lg h-64">
        <h3 className="text-gray-300 font-medium mb-4">Kunlik Ro'yxatdan O'tishlar</h3>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={stats.signupData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid stroke="#374151" strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke="#9CA3AF" tick={{fontSize: 12}} />
            <YAxis stroke="#9CA3AF" tick={{fontSize: 12}} allowDecimals={false} />
            <RechartsTooltip 
              contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#fff' }}
              itemStyle={{ color: '#60A5FA' }}
            />
            <Line type="monotone" dataKey="count" stroke="#3B82F6" strokeWidth={3} dot={{ r: 4, fill: '#3B82F6' }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
