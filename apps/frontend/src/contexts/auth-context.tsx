'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';

interface User {
  id: string;
  username: string;
  fullName?: string;
  email: string;
  role: string;
  isForcePasswordChange: boolean;
}

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// On a 401 (expired access token), try one silent refresh and retry the
// original request before giving up — avoids surfacing a raw "Authentication
// Required" toast for what is really just an expired access token.
let refreshPromise: Promise<boolean> | null = null;

function attemptRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = api
      .post('/auth/refresh')
      .then((res) => !!res.data?.user)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    // /auth/me's 401 is the normal "not logged in yet" check on every page
    // load (see checkAuth below) — it must not be treated as an expired
    // session, or every logged-out visit force-redirects with a false
    // "session expired" message.
    const isAuthEndpoint =
      config?.url?.startsWith('/auth/login') ||
      config?.url?.startsWith('/auth/refresh') ||
      config?.url?.startsWith('/auth/me');

    if (response?.status === 401 && !isAuthEndpoint && !config?._retriedAfterRefresh) {
      const refreshed = await attemptRefresh();
      if (refreshed) {
        config._retriedAfterRefresh = true;
        return api(config);
      }
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login?sessionExpired=1';
      }
    }

    return Promise.reject(error);
  },
);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await api.get('/auth/me');
      setUser(response.data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (username: string, password: string, rememberMe?: boolean) => {
    const response = await api.post('/auth/login', { username, password, rememberMe });
    setUser(response.data.user);
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export { api };
