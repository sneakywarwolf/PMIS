'use client';

import { PhoneInput } from '@/components/phone-input';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { User, Eye, EyeOff, Lock, Save, Phone, Briefcase, Shield } from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';
import { useBranding } from '@/contexts/branding-context';

interface ProfileData {
  id: string;
  username: string;
  email: string;
  role: string;
  fullName?: string;
  phone?: string;
  designation?: string;
  teamLead?: { id: string; username: string; fullName?: string } | null;
  manager?: { id: string; username: string; fullName?: string } | null;
  isForcePasswordChange: boolean;
}

export default function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Admin-configured policy; the server re-checks it, this is just an early message.
  const minLength: number = useBranding().settings?.security?.passwordMinLength ?? 8;
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordVisibility, setPasswordVisibility] = useState({ current: false, new: false, confirm: false });
  const [editForm, setEditForm] = useState({ fullName: '', phone: '', designation: '' });
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await api.get('/users/profile');
      setProfile(response.data);
      setEditForm({
        fullName: response.data.fullName || '',
        phone: response.data.phone || '',
        designation: response.data.designation || '',
      });
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    setSaving(true);
    try {
      await api.put('/users/profile', editForm);
      setMessage('Profile updated successfully');
      fetchProfile();
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setMessage('New passwords do not match');
      return;
    }
    if (passwordForm.newPassword.length < minLength) {
      setMessage(`Password must be at least ${minLength} characters`);
      return;
    }
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setMessage('Password changed successfully');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordVisibility({ current: false, new: false, confirm: false });
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Password change failed');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">My Profile</h1>
        <p className="text-gray-400 text-sm mt-1">Manage your personal information and security</p>
      </div>

      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-3 rounded-lg ${message.includes('success') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}
        >
          {message}
        </motion.div>
      )}

      {/* Profile Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-xl p-6 space-y-6"
      >
        <div className="flex items-center gap-4 pb-4 border-b border-gray-700">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <User className="w-8 h-8 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">{profile?.fullName || profile?.username}</h2>
            <p className="text-sm text-gray-400">{profile?.email}</p>
            <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-400 capitalize">
              {profile?.role.toLowerCase()}
            </span>
          </div>
        </div>

        {/* Read-only fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ProfileField label="Username" value={profile?.username || ''} icon={User} />
          <ProfileField label="Email" value={profile?.email || ''} icon={Shield} />
          <ProfileField
            label="Team Lead"
            value={profile?.teamLead?.fullName || profile?.teamLead?.username || 'N/A'}
            icon={Shield}
          />
          <ProfileField
            label="Manager"
            value={profile?.manager?.fullName || profile?.manager?.username || 'N/A'}
            icon={Briefcase}
          />
        </div>

        {/* Editable fields */}
        <div className="space-y-4 pt-4 border-t border-gray-700">
          <h3 className="text-sm font-medium text-emerald-400 uppercase tracking-wide">Edit Profile</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Full Name</label>
              <input
                type="text"
                value={editForm.fullName}
                onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm"
                placeholder="Enter full name"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Phone</label>
              <PhoneInput value={editForm.phone} onChange={(phone) => setEditForm({ ...editForm, phone })} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Designation</label>
              <input
                type="text"
                value={editForm.designation}
                onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm"
                placeholder="Security Analyst"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleUpdateProfile}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm transition-all disabled:opacity-50"
            >
              {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Changes</>}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Password Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card rounded-xl p-6 space-y-4"
      >
        <div className="flex items-center gap-3 pb-4 border-b border-gray-700">
          <Lock className="w-5 h-5 text-emerald-400" />
          <h3 className="text-lg font-semibold text-white">Reset Password</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PasswordInput
            label="Current Password"
            value={passwordForm.currentPassword}
            onChange={(v) => setPasswordForm({ ...passwordForm, currentPassword: v })}
            visible={passwordVisibility.current}
            onToggle={() => setPasswordVisibility(p => ({ ...p, current: !p.current }))}
          />
          <PasswordInput
            label="New Password"
            value={passwordForm.newPassword}
            onChange={(v) => setPasswordForm({ ...passwordForm, newPassword: v })}
            visible={passwordVisibility.new}
            onToggle={() => setPasswordVisibility(p => ({ ...p, new: !p.new }))}
          />
          <PasswordInput
            label="Confirm New Password"
            value={passwordForm.confirmPassword}
            onChange={(v) => setPasswordForm({ ...passwordForm, confirmPassword: v })}
            visible={passwordVisibility.confirm}
            onToggle={() => setPasswordVisibility(p => ({ ...p, confirm: !p.confirm }))}
          />
        </div>
        <div className="flex justify-end">
          <button
            onClick={handleChangePassword}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-all"
          >
            Reset Password
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function PasswordInput({ label, value, onChange, visible, onToggle }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 pr-10 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-white transition-all"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function ProfileField({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
      <Icon className="w-4 h-4 text-emerald-400" />
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm text-white">{value}</p>
      </div>
    </div>
  );
}
