import React, { useEffect, useState } from 'react';
import SplashScreen from './pages/SplashScreen';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import PresentationSlides from './pages/PresentationSlides';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import AdminDashboard from './pages/AdminDashboard';
import UserDashboard from './pages/UserDashboard';
import DesignSystem from './pages/DesignSystem';
import { UserAccount, UserRole } from './types';
import { api, AUTH_EXPIRED } from './lib/api';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [showLanding, setShowLanding] = useState(true);
  const [showPresentation, setShowPresentation] = useState(false);
  const [viewDesignSystem, setViewDesignSystem] = useState(false);

  useEffect(() => {
    const bootstrapSession = async () => {
      const savedUser = localStorage.getItem('finsight_user');
      const savedToken = localStorage.getItem('finsight_token');

      if (!savedUser || !savedToken) {
        localStorage.removeItem('finsight_user');
        localStorage.removeItem('finsight_token');
        setIsInitialized(true);
        return;
      }

      try {
        const me = await api.me();
        localStorage.setItem('finsight_user', JSON.stringify(me.user));
        setCurrentUser(me.user);
        setShowLanding(false);
        setShowSplash(false);
      } catch {
        localStorage.removeItem('finsight_user');
        localStorage.removeItem('finsight_token');
        setCurrentUser(null);
      } finally {
        setIsInitialized(true);
      }
    };

    bootstrapSession();
  }, []);

  useEffect(() => {
    const handleAuthExpired = () => {
      setCurrentUser(null);
      setShowLanding(true);
      setShowPresentation(false);
      setShowSplash(false);
    };

    window.addEventListener(AUTH_EXPIRED, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED, handleAuthExpired);
  }, []);

  const handleLogin = (user: UserAccount) => {
    setCurrentUser(user);
    setShowLanding(false);
    setShowSplash(false);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setShowLanding(true);
    setShowPresentation(false);
    localStorage.removeItem('finsight_user');
    localStorage.removeItem('finsight_token');
  };

  if (!isInitialized) return null;

  if (viewDesignSystem) {
    return <DesignSystem onExit={() => setViewDesignSystem(false)} />;
  }

  if (showSplash && !currentUser) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
  }

  if (showPresentation && !currentUser) {
    return (
      <PresentationSlides
        onClose={() => setShowPresentation(false)}
        onStartApp={() => {
          setShowPresentation(false);
          setShowLanding(false);
        }}
      />
    );
  }

  if (!currentUser && showLanding) {
    return <LandingPage onEnter={() => setShowLanding(false)} onStartTour={() => setShowPresentation(true)} />;
  }

  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  switch (currentUser.account_type) {
    case UserRole.SUPER_ADMIN:
      return <SuperAdminDashboard user={currentUser} onLogout={handleLogout} />;
    case UserRole.ADMIN:
      return <AdminDashboard user={currentUser} onLogout={handleLogout} />;
    case UserRole.EMPLOYEE:
      return <UserDashboard user={currentUser} onLogout={handleLogout} />;
    default:
      return <LoginPage onLogin={handleLogin} />;
  }
};

export default App;
