
import React, { useState, useRef, useEffect } from 'react';
import { UserAccount, UserRole } from '../types';
import { SIDEBAR_ITEMS } from '../constants';
import Logo from './Logo';
import { 
  LogOut, 
  Bell, 
  Search, 
  Menu, 
  X, 
  AlertCircle, 
  CheckCircle2, 
  Info, 
  Calendar,
  MoreVertical,
  Trash2,
  ExternalLink
} from 'lucide-react';

interface LayoutProps {
  user: UserAccount;
  onLogout: () => void;
  children: React.ReactNode;
  activePath?: string;
  onNavigate?: (path: string) => void;
}

interface NotificationItem {
  id: string;
  title: string;
  description: string;
  time: string;
  type: 'warning' | 'success' | 'info';
  isRead: boolean;
  targetPath?: string;
}

const Layout: React.FC<LayoutProps> = ({ user, onLogout, children, activePath, onNavigate }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);

  const [notifications, setNotifications] = useState<NotificationItem[]>([
    {
      id: '1',
      title: 'High Risk Transaction',
      description: 'A transaction of TK 4,500 in Engineering was flagged for review.',
      time: '2 mins ago',
      type: 'warning',
      isRead: false,
      targetPath: user.account_type === UserRole.EMPLOYEE ? '/analysis' : '/dept-status'
    },
    {
      id: '2',
      title: 'Budget Milestone',
      description: 'Marketing department has utilized 75% of its quarterly budget.',
      time: '1 hour ago',
      type: 'info',
      isRead: false,
      targetPath: user.account_type === UserRole.EMPLOYEE ? '/departments' : '/dept-status'
    },
    {
      id: '3',
      title: 'Monthly Report Ready',
      description: 'The forensic audit report for January 2025 is now available.',
      time: '5 hours ago',
      type: 'success',
      isRead: true,
      targetPath: '/history'
    }
  ]);

  // Simulate a live notification arriving after 5 seconds for demo purposes
  useEffect(() => {
    const timer = setTimeout(() => {
      const newNotif: NotificationItem = {
        id: Date.now().toString(),
        title: 'System Optimization',
        description: 'AI detected 3 unused SaaS licenses in Sales unit.',
        time: 'Just now',
        type: 'info',
        isRead: false,
        targetPath: user.account_type === UserRole.EMPLOYEE ? '/analysis' : '/reports'
      };
      setNotifications(prev => [newNotif, ...prev]);
    }, 8000);
    return () => clearTimeout(timer);
  }, [user.account_type]);

  // Handle click outside to close notifications
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const menuItems = SIDEBAR_ITEMS[user.account_type];
  const unreadCount = notifications.filter(n => !n.isRead).length;

  const roleLabels = {
    [UserRole.SUPER_ADMIN]: 'Super Admin',
    [UserRole.ADMIN]: 'Company Admin',
    [UserRole.EMPLOYEE]: 'Employee'
  };

  const markAllAsRead = () => {
    setNotifications(notifications.map(n => ({ ...n, isRead: true })));
  };

  const clearAllNotifications = () => {
    setNotifications([]);
    setIsNotificationsOpen(false);
  };

  const dismissNotification = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setNotifications(notifications.filter(n => n.id !== id));
  };

  const handleNotificationClick = (notif: NotificationItem) => {
    // Mark as read
    setNotifications(notifications.map(n => n.id === notif.id ? { ...n, isRead: true } : n));
    
    // Navigate if target exists
    if (notif.targetPath && onNavigate) {
      onNavigate(notif.targetPath);
    }
    
    setIsNotificationsOpen(false);
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f5f9ff_0%,#eef4ff_28%,#f8fafc_100%)] flex overflow-hidden">
      {/* Sidebar */}
      <aside className={`bg-[#121a2f] text-white w-[252px] fixed inset-y-0 left-0 z-50 transition-transform duration-300 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0 shadow-[30px_0_60px_rgba(15,23,42,0.18)]`}>
        <div className="flex items-center justify-between p-6 border-b border-white/6">
          <div className="flex items-center gap-3">
            <div className="bg-white/5 p-1.5 rounded-2xl border border-white/10 shadow-inner">
              <Logo size={28} variant="white" />
            </div>
            <div>
              <span className="text-xl font-black tracking-tighter">FinSight</span>
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-200/80 mt-1">Advisor Suite</p>
            </div>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-400">
            <X size={20} />
          </button>
        </div>

        <nav className="p-4 space-y-2">
          {menuItems.map((item) => {
            const isActive = activePath === item.path;
            return (
              <button
                key={item.name}
                onClick={() => onNavigate?.(item.path)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all group ${
                  isActive 
                  ? 'bg-[#2f67ec] text-white shadow-[0_18px_35px_rgba(47,103,236,0.32)]' 
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <item.icon size={19} className={isActive ? 'text-white' : 'text-slate-400 group-hover:text-blue-300 transition-colors'} />
                <span className="font-bold text-sm tracking-tight">{item.name}</span>
              </button>
            );
          })}
        </nav>

        <div className="absolute bottom-0 w-full p-4 border-t border-white/6">
          <button 
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-red-300 hover:bg-red-500/10 rounded-2xl transition-all"
          >
            <LogOut size={20} />
            <span className="font-bold text-sm">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {/* Top Bar */}
        <header className="sticky top-0 z-40 border-b border-white/60 bg-white/80 backdrop-blur-xl">
          <div className="h-20 flex items-center justify-between px-6 md:px-8">
            <div className="flex items-center gap-4 lg:gap-0">
              <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden text-slate-600">
                <Menu size={24} />
              </button>
              <div className="hidden md:flex items-center bg-white rounded-2xl px-4 py-3 w-64 lg:w-[420px] border border-slate-200 shadow-[0_12px_28px_rgba(15,23,42,0.05)] focus-within:ring-2 focus-within:ring-blue-500 transition-all">
                <Search size={18} className="text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search dashboard..." 
                  className="bg-transparent border-none focus:ring-0 text-sm w-full ml-2 text-slate-700 placeholder-slate-400 font-medium"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Notification Bell with Dropdown */}
              <div className="relative" ref={notificationRef}>
                <button 
                  onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                  className={`relative p-3 rounded-2xl transition-all group border ${isNotificationsOpen ? 'bg-blue-50 text-blue-600 border-blue-100' : 'text-slate-600 hover:bg-white border-slate-200 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.05)]'}`}
                >
                  <Bell size={20} className={unreadCount > 0 ? 'animate-wiggle' : ''} />
                  {unreadCount > 0 && (
                    <span className="absolute top-2 right-2.5 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse shadow-sm shadow-red-500/50"></span>
                  )}
                </button>

                {/* Notifications Dropdown */}
                {isNotificationsOpen && (
                  <div className="absolute right-0 mt-3 w-80 md:w-96 bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200 origin-top-right">
                    <div className="p-5 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
                      <div>
                        <h3 className="font-bold text-slate-900">Notifications</h3>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                          {unreadCount} Unread Alerts
                        </p>
                      </div>
                      <button 
                        onClick={markAllAsRead}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors px-3 py-1.5 bg-blue-50 rounded-lg"
                      >
                        Mark all as read
                      </button>
                    </div>
                    
                    <div className="max-h-[420px] overflow-y-auto custom-scrollbar">
                      {notifications.length > 0 ? (
                        <div className="divide-y divide-slate-50">
                          {notifications.map((n) => (
                            <div 
                              key={n.id} 
                              onClick={() => handleNotificationClick(n)}
                              className={`group p-5 flex gap-4 transition-all cursor-pointer relative ${!n.isRead ? 'bg-blue-50/40' : 'hover:bg-slate-50'}`}
                            >
                              {/* Read Indicator Stripe */}
                              {!n.isRead && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>}
                              
                              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110 ${
                                n.type === 'warning' ? 'bg-red-100 text-red-600' : 
                                n.type === 'success' ? 'bg-emerald-100 text-emerald-600' : 
                                'bg-blue-100 text-blue-600'
                              }`}>
                                {n.type === 'warning' ? <AlertCircle size={20} /> : 
                                 n.type === 'success' ? <CheckCircle2 size={20} /> : 
                                 <Info size={20} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start mb-1">
                                  <h4 className={`text-sm font-bold truncate pr-4 ${!n.isRead ? 'text-slate-900' : 'text-slate-600'}`}>
                                    {n.title}
                                  </h4>
                                  <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap mt-0.5">{n.time}</span>
                                </div>
                                <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 pr-4">{n.description}</p>
                                
                                {n.targetPath && (
                                  <div className="mt-2 flex items-center gap-1 text-[9px] font-black text-blue-600 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                                    Take Action <ExternalLink size={10} />
                                  </div>
                                )}
                              </div>

                              {/* Dismiss Button */}
                              <button 
                                onClick={(e) => dismissNotification(e, n.id)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-16 text-center">
                          <div className="w-20 h-20 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mx-auto mb-6 text-slate-300 border-2 border-dashed border-slate-200">
                            <Bell size={32} />
                          </div>
                          <p className="text-slate-900 font-bold">No new notifications</p>
                          <p className="text-slate-400 text-xs mt-1 font-medium">We'll let you know when something <br/> important happens.</p>
                        </div>
                      )}
                    </div>

                    <div className="p-4 border-t border-slate-50 flex items-center justify-between bg-slate-50/30">
                      <button className="text-[10px] font-black text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-widest px-3 py-2">
                        View all activity
                      </button>
                      <button 
                        onClick={clearAllNotifications}
                        className="text-[10px] font-black text-red-400 hover:text-red-600 transition-colors uppercase tracking-widest px-3 py-2"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="h-8 w-[1px] bg-slate-200"></div>

              <div className="flex items-center gap-3 cursor-pointer hover:bg-white p-2 rounded-2xl transition-all border border-slate-200 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-bold text-slate-800 leading-none">{user.name}</p>
                  <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-black">{roleLabels[user.account_type]}</p>
                </div>
                <div className="w-10 h-10 bg-[#2f67ec] text-white rounded-2xl flex items-center justify-center font-black shadow-[0_12px_24px_rgba(47,103,236,0.24)]">
                  {user.name.charAt(0)}
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="p-6 md:p-8">
          <div className="mx-auto max-w-[1500px]">
            {children}
          </div>
        </div>
      </main>
      
      <style>{`
        @keyframes wiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(10deg); }
          75% { transform: rotate(-10deg); }
        }
        .animate-wiggle {
          animation: wiggle 0.5s ease-in-out infinite;
          animation-iteration-count: 2;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  );
};

export default Layout;
