
import React, { useState, useEffect } from 'react';
import { UserAccount, UserRole } from './types';
import SplashScreen from './pages/SplashScreen';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import PresentationSlides from './pages/PresentationSlides';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import AdminDashboard from './pages/AdminDashboard';
import UserDashboard from './pages/UserDashboard';
import DesignSystem from './pages/DesignSystem';
import { MOCK_ACCOUNTS } from './constants';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [showLanding, setShowLanding] = useState(true);
  const [showPresentation, setShowPresentation] = useState(false);
  const [viewDesignSystem, setViewDesignSystem] = useState(false);

  useEffect(() => {
    if (window.location.hash === '#design') {
      setViewDesignSystem(true);
    }

    const savedUser = localStorage.getItem('finsight_user');
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      setCurrentUser(parsedUser);
      setShowLanding(false);
      setShowSplash(false);
    }
    setIsInitialized(true);

    const handleHashChange = () => {
      setViewDesignSystem(window.location.hash === '#design');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleLogin = (accountNo: string, password: string) => {
    const user = MOCK_ACCOUNTS.find(acc => acc.account_no === accountNo);
    if (user && password) {
      setCurrentUser(user);
      localStorage.setItem('finsight_user', JSON.stringify(user));
    } else {
      alert("Invalid credentials. Try SA001, ADM001, or EMP001");
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setShowLanding(true);
    setShowSplash(false);
    setShowPresentation(false);
    localStorage.removeItem('finsight_user');
  };

  if (!isInitialized) return null;

  if (viewDesignSystem) {
    return <DesignSystem onExit={() => {
      window.location.hash = '';
      setViewDesignSystem(false);
    }} />;
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
    return (
      <LandingPage 
        onEnter={() => setShowLanding(false)} 
        onStartTour={() => setShowPresentation(true)}
      />
    );
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
