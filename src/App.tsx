import React, { Suspense, lazy, useCallback, useState, useMemo, useEffect, useRef } from 'react';
import { WorkCalendar } from './components/WorkCalendar';
import { UserProfileModal } from './components/UserProfileModal';
import { Login } from './components/Login';
import { MOCK_EMPLOYEES, generateInitialLogs, DEPARTMENTS, POSITIONS, INITIAL_HOLIDAYS, isWorkingDay } from './constants';
import { LocationType, WorkLog, Employee, UserRole, LeaveRequest, LeaveStatus, LeaveType, CompanyHoliday, Notification } from './types';
import { LayoutDashboard, Calendar, Bell, Menu, X, Clock, UserCog, LogOut, Building2, MapPin, Home, UserCheck, ClipboardList, ChevronDown, RefreshCw, Shield, Sparkles, User, Plane, Check, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { format, isWithinInterval, isBefore, isAfter, isSameDay } from 'date-fns';

const ManagerDashboard = lazy(() => import('./components/ManagerDashboard').then(module => ({ default: module.ManagerDashboard })));
const AdminPanel = lazy(() => import('./components/AdminPanel').then(module => ({ default: module.AdminPanel })));
const LeavePanel = lazy(() => import('./components/LeavePanel').then(module => ({ default: module.LeavePanel })));
const ProfilePanel = lazy(() => import('./components/ProfilePanel').then(module => ({ default: module.ProfilePanel })));

const startOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const startOfMonth = (date: Date): Date => {
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

const subDays = (date: Date, amount: number): Date => {
  const d = new Date(date);
  d.setDate(d.getDate() - amount);
  return d;
};

type Tab = 'home' | 'dashboard' | 'leave' | 'admin' | 'profile';

const STORAGE_KEYS = {
  currentUserId: 'hrapp.currentUserId',
  employees: 'hrapp.employees',
};

const TAB_TO_PATH: Record<Tab, string> = {
  home: '/',
  dashboard: '/dashboard',
  leave: '/leave',
  admin: '/admin',
  profile: '/profile',
};

const PATH_TO_TAB: Record<string, Tab> = {
  '/': 'home',
  '/dashboard': 'dashboard',
  '/leave': 'leave',
  '/admin': 'admin',
  '/profile': 'profile',
};

const getTabFromPath = (pathname: string = window.location.pathname): Tab => {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return PATH_TO_TAB[normalizedPath] || 'home';
};

const loadStoredEmployees = (): Employee[] => {
  try {
    const storedEmployees = window.localStorage.getItem(STORAGE_KEYS.employees);
    if (!storedEmployees) return MOCK_EMPLOYEES;

    const parsed = JSON.parse(storedEmployees);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : MOCK_EMPLOYEES;
  } catch {
    return MOCK_EMPLOYEES;
  }
};

const App: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>(() => loadStoredEmployees());
  const [departments, setDepartments] = useState<string[]>(DEPARTMENTS);
  const [positions, setPositions] = useState<string[]>(POSITIONS);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>(INITIAL_HOLIDAYS);
  const [isUpdatingHolidays, setIsUpdatingHolidays] = useState(false);
  
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    const storedUserId = window.localStorage.getItem(STORAGE_KEYS.currentUserId);
    return Boolean(storedUserId && employees.some(employee => employee.id === storedUserId));
  });
  const [currentUser, setCurrentUser] = useState<Employee>(() => {
    const storedUserId = window.localStorage.getItem(STORAGE_KEYS.currentUserId);
    return employees.find(employee => employee.id === storedUserId) || employees[0];
  }); 
  const [selectedProfileUser, setSelectedProfileUser] = useState<Employee | null>(null);

  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([
    {
      id: 'leave-1',
      employeeId: 'emp-staff-01',
      type: LeaveType.SICK,
      startDate: format(new Date(), 'yyyy-MM-dd'),
      endDate: format(new Date(), 'yyyy-MM-dd'),
      duration: 'Full Day' as any,
      totalDays: 1,
      reason: 'มีอาการปวดหัวตัวร้อน',
      status: LeaveStatus.PENDING,
      timestamp: new Date().toISOString()
    }
  ]);
  const [activeTab, setActiveTab] = useState<Tab>(() => getTabFromPath());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [selectedDateForModal, setSelectedDateForModal] = useState<Date | null>(null);
  
  // New state to track acknowledged notifications
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());
  
  const notificationsRef = useRef<HTMLDivElement>(null);

  const navigateToTab = useCallback((tab: Tab, replace = false) => {
    const nextPath = TAB_TO_PATH[tab];
    setActiveTab(tab);

    if (window.location.pathname !== nextPath) {
      const historyMethod = replace ? window.history.replaceState : window.history.pushState;
      historyMethod.call(window.history, null, '', nextPath);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(getTabFromPath());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    setLogs(generateInitialLogs(employees));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.employees, JSON.stringify(employees));
  }, [employees]);

  useEffect(() => {
    if (!isLoggedIn) return;

    const refreshedCurrentUser = employees.find(employee => employee.id === currentUser.id);
    if (refreshedCurrentUser) {
      setCurrentUser(refreshedCurrentUser);
      return;
    }

    window.localStorage.removeItem(STORAGE_KEYS.currentUserId);
    setIsLoggedIn(false);
    setCurrentUser(employees[0]);
    navigateToTab('home', true);
  }, [currentUser.id, employees, isLoggedIn, navigateToTab]);

  useEffect(() => {
    const fetchThaiHolidays = async () => {
      setIsUpdatingHolidays(true);
      try {
        const { GoogleGenAI, Type } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const currentYear = new Date().getFullYear();
        const yearsToFetch = [currentYear - 1, currentYear, currentYear + 1];
        
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `List all official Thai public holidays for the years ${yearsToFetch.join(', ')}. Return clean JSON array.`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  date: { type: Type.STRING },
                  name: { type: Type.STRING }
                },
                required: ["id", "date", "name"]
              }
            }
          }
        });

        const fetchedHolidays = JSON.parse(response.text);
        if (Array.isArray(fetchedHolidays)) {
          setHolidays(prev => {
            const existingDates = new Set(prev.map(h => h.date));
            const uniqueNew = fetchedHolidays.filter(h => !existingDates.has(h.date));
            return [...prev, ...uniqueNew].sort((a, b) => a.date.localeCompare(b.date));
          });
        }
      } catch (error) {
        console.error("Failed to fetch Thai holidays:", error);
      } finally {
        setIsUpdatingHolidays(false);
      }
    };
    fetchThaiHolidays();
  }, []);

  // Enhanced Notification Logic for Leave Requests and Status Updates
  const allNotifications = useMemo((): Notification[] => {
    const list: Notification[] = [];
    const today = startOfDay(new Date());

    // 1. Missing Check-ins (Account related)
    const monthBegin = startOfMonth(new Date());
    let d = new Date(monthBegin);
    while (d <= today) {
      const dateStr = format(d, 'yyyy-MM-dd');
      const hasLog = logs.some(l => l.employeeId === currentUser.id && l.date === dateStr);
      const isWorking = isWorkingDay(d, holidays);
      
      if (!hasLog && isWorking) {
        const isOnLeave = leaveRequests.some(r => 
          r.employeeId === currentUser.id && 
          (r.status === LeaveStatus.APPROVED || r.status === LeaveStatus.PENDING) &&
          isWithinInterval(startOfDay(d), { start: startOfDay(new Date(r.startDate)), end: startOfDay(new Date(r.endDate)) })
        );

        if (!isOnLeave) {
          list.push({
            id: `missing-${dateStr}`,
            title: 'Missing Check-in',
            message: `Don't forget to check-in for ${format(d, 'EEE, d MMM')}`,
            timestamp: new Date(d.setHours(9,0,0,0)).toISOString(),
            isRead: readNotificationIds.has(`missing-${dateStr}`),
            type: 'checkin',
            tabLink: 'home'
          });
        }
      }
      d.setDate(d.getDate() + 1);
    }

    // 2. Pending Approvals (For Managers/Admins)
    if (currentUser.role !== 'Employee') {
      const pendingForReview = leaveRequests.filter(r => {
        if (r.status !== LeaveStatus.PENDING || r.employeeId === currentUser.id) return false;
        if (currentUser.role === 'Admin') return true;
        const requester = employees.find(e => e.id === r.employeeId);
        return requester?.managerId === currentUser.id;
      });

      pendingForReview.forEach(r => {
        const emp = employees.find(e => e.id === r.employeeId);
        list.push({
          id: `pending-${r.id}`,
          title: 'New Leave Request',
          message: `${emp?.name} requested ${r.type}. Action required.`,
          timestamp: r.timestamp,
          isRead: readNotificationIds.has(`pending-${r.id}`),
          type: 'leave',
          tabLink: 'leave'
        });
      });
    }

    // 3. Status Updates (For Employee's own account)
    const myLeaveUpdates = leaveRequests.filter(r => 
      r.employeeId === currentUser.id && 
      (r.status === LeaveStatus.APPROVED || r.status === LeaveStatus.REJECTED)
    );

    myLeaveUpdates.forEach(r => {
      list.push({
        id: `update-${r.id}-${r.status}`,
        title: `Leave Request ${r.status}`,
        message: `Your request for ${r.type} (${format(new Date(r.startDate), 'd MMM')}) has been ${r.status.toLowerCase()}.`,
        timestamp: new Date().toISOString(), 
        isRead: readNotificationIds.has(`update-${r.id}-${r.status}`),
        type: 'leave',
        tabLink: 'leave'
      });
    });

    return list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [logs, leaveRequests, currentUser.id, currentUser.role, holidays, employees, readNotificationIds]);

  const unreadCount = allNotifications.filter(n => !n.isRead).length;

  const lazyPageFallback = (
    <div className="flex min-h-[360px] items-center justify-center rounded-[2rem] border border-slate-200 bg-white text-slate-400">
      <RefreshCw size={22} className="animate-spin" />
    </div>
  );

  const handleMarkAllAsRead = () => {
    const newReadIds = new Set(readNotificationIds);
    allNotifications.forEach(n => newReadIds.add(n.id));
    setReadNotificationIds(newReadIds);
  };

  const handleNotificationClick = (n: Notification) => {
    const newReadIds = new Set(readNotificationIds);
    newReadIds.add(n.id);
    setReadNotificationIds(newReadIds);
    
    if (n.tabLink) navigateToTab(n.tabLink);
    setIsNotificationsOpen(false);
  };

  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const todayLog = useMemo(() => logs.find(l => l.employeeId === currentUser.id && l.date === todayStr), [logs, currentUser.id, todayStr]);

  const todayLeave = useMemo(() => {
    return leaveRequests.find(req => {
      if (req.employeeId !== currentUser.id) return false;
      if (req.status !== LeaveStatus.PENDING && req.status !== LeaveStatus.APPROVED) return false;
      const today = startOfDay(new Date());
      const start = startOfDay(new Date(req.startDate));
      const end = startOfDay(new Date(req.endDate));
      return isWithinInterval(today, { start, end });
    });
  }, [leaveRequests, currentUser.id]);

  const handleLogin = (user: Employee) => {
    setCurrentUser(user);
    setIsLoggedIn(true);
    window.localStorage.setItem(STORAGE_KEYS.currentUserId, user.id);
    setReadNotificationIds(new Set()); 
  };

  const handleRegister = (newUser: Employee) => {
    setEmployees(prev => [...prev, newUser]);
    setCurrentUser(newUser);
    setIsLoggedIn(true);
    window.localStorage.setItem(STORAGE_KEYS.currentUserId, newUser.id);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setIsProfileOpen(false);
    setIsNotificationsOpen(false);
    window.localStorage.removeItem(STORAGE_KEYS.currentUserId);
    navigateToTab('home', true);
  };

  const handleShowProfile = (user: Employee) => {
    if (user.id === currentUser.id) {
      navigateToTab('profile');
    } else {
      setSelectedProfileUser(user);
    }
  };

  const handleCheckIn = (
    dateOrDates: string | string[], 
    type: LocationType, 
    note?: string, 
    customTimestamp?: string,
    startTime?: string,
    endTime?: string
  ) => {
    const dates = Array.isArray(dateOrDates) ? dateOrDates : [dateOrDates];
    setLogs(prev => {
      let filtered = [...prev];
      if (!startTime) {
        filtered = filtered.filter(l => !(l.employeeId === currentUser.id && dates.includes(l.date)));
      } else {
        filtered = filtered.filter(l => {
          const isSameUserDate = l.employeeId === currentUser.id && dates.includes(l.date);
          if (!isSameUserDate) return true;
          const isFullDay = !l.startTime;
          const isSameStartTime = l.startTime === startTime;
          return !(isFullDay || isSameStartTime);
        });
      }
      
      const newLogs: WorkLog[] = dates.map(date => ({
        id: `log-${currentUser.id}-${date}-${Date.now()}-${startTime || 'full'}`,
        employeeId: currentUser.id,
        date: date,
        type,
        timestamp: customTimestamp || new Date().toISOString(),
        note,
        startTime,
        endTime
      }));
      return [...filtered, ...newLogs];
    });
  };

  const handleRemoveCheckIn = (date: string) => {
    setLogs(prev => prev.filter(l => !(l.employeeId === currentUser.id && l.date === date)));
  };

  const handleAddEmployee = (emp: Employee) => setEmployees(prev => [...prev, emp]);
  const handleUpdateEmployee = (emp: Employee) => {
    setEmployees(prev => prev.map(e => e.id === emp.id ? emp : e));
    if (currentUser.id === emp.id) setCurrentUser(emp);
  };
  const handleRemoveEmployee = (id: string) => {
    setEmployees(prev => prev.filter(e => e.id !== id));
    setLogs(prev => prev.filter(l => l.employeeId !== id));
  };
  const handleSaveSettings = (newDepts: string[], newPos: string[], newHolidays: CompanyHoliday[]) => {
    setDepartments(newDepts);
    setPositions(newPos);
    setHolidays(newHolidays);
  };

  const handleLeaveAction = (requestId: string, action: LeaveStatus) => {
    setLeaveRequests(prev => prev.map(req => 
      req.id === requestId ? { ...req, status: action } : req
    ));
  };

  const handleAddLeave = (request: LeaveRequest) => {
    setLeaveRequests(prev => [request, ...prev]);
  };

  const menuItems = [
    { id: 'home', label: 'Work Calendar', icon: Calendar },
    { id: 'dashboard', label: 'Team Dashboard', icon: LayoutDashboard, requiresRole: ['Manager', 'Admin'] },
    { id: 'leave', label: 'Leave Requests', icon: ClipboardList },
    { id: 'admin', label: 'User Management', icon: UserCog, requiresRole: ['Admin'] },
    { id: 'profile', label: 'My Profile', icon: User, hidden: true },
  ];

  const visibleMenuItems = menuItems.filter(item => 
    (!item.requiresRole || (item.requiresRole as UserRole[]).includes(currentUser.role)) && !item.hidden
  );

  useEffect(() => {
    if (!isLoggedIn) return;

    const activeMenuItem = menuItems.find(item => item.id === activeTab);
    const canAccessActiveTab = !activeMenuItem?.requiresRole || (activeMenuItem.requiresRole as UserRole[]).includes(currentUser.role);

    if (!canAccessActiveTab) {
      navigateToTab('home', true);
    }
  }, [activeTab, currentUser.role, isLoggedIn, navigateToTab]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isLoggedIn) {
    return <Login employees={employees} departments={departments} positions={positions} onLogin={handleLogin} onRegister={handleRegister} />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'home': 
        return (
          <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 md:gap-6 bg-white p-5 sm:p-6 lg:p-8 rounded-[2rem] lg:rounded-[2.5rem] border border-slate-200 shadow-sm mb-6 lg:mb-8 animate-in slide-in-from-top-4 duration-500 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-full -mr-16 -mt-16 opacity-50"></div>
              <div className="flex flex-col relative z-10">
                <span className="text-slate-400 text-xs font-black uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                  {format(new Date(), 'EEEE')}
                  {isUpdatingHolidays && <span className="flex items-center gap-1 text-[10px] text-indigo-400 normal-case animate-pulse"><Sparkles size={10} /> Auto-updating holidays...</span>}
                </span>
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-slate-900 tracking-tight leading-tight">{format(new Date(), 'MMMM d, yyyy')}</h2>
              </div>
              <div className="flex flex-col items-start md:items-end gap-4 relative z-10">
                <div className="flex flex-col items-start md:items-end w-full sm:w-auto">
                  <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-1.5"><Clock size={12} className="text-slate-300" /> My Daily Status</span>
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <button 
                      onClick={() => setSelectedDateForModal(new Date())}
                      className={`w-full sm:w-auto flex items-center justify-between sm:justify-start gap-4 px-5 sm:px-6 py-3.5 rounded-3xl border shadow-sm transition-all hover:scale-[1.02] active:scale-95 text-left
                        ${todayLog ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : todayLeave ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-rose-50 text-rose-600 border-rose-100 animate-pulse'}
                      `}
                    >
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-tighter opacity-60">{todayLog ? 'Checked In' : (todayLeave ? 'On Leave' : 'Action Required')}</span>
                        <span className="font-black text-xl tracking-tight">{todayLog ? todayLog.type : (todayLeave ? todayLeave.type : 'Not Checked In')}</span>
                      </div>
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg ${todayLog ? 'bg-emerald-500 shadow-emerald-200' : todayLeave ? 'bg-indigo-500 shadow-indigo-200' : 'bg-rose-500 shadow-rose-200'}`}>
                        {todayLog ? <UserCheck size={24} /> : todayLeave ? <Plane size={24} /> : <X size={24} />}
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <WorkCalendar logs={logs} employees={employees} departments={departments} holidays={holidays} currentUser={currentUser} leaveRequests={leaveRequests} onCheckIn={handleCheckIn} onRemoveCheckIn={handleRemoveCheckIn} externalSelectedDate={selectedDateForModal} onExternalDateChange={setSelectedDateForModal} onViewProfile={handleShowProfile} />
          </div>
        );
      case 'dashboard': return <Suspense fallback={lazyPageFallback}><ManagerDashboard logs={logs} employees={employees} departments={departments} leaveRequests={leaveRequests} holidays={holidays} onViewProfile={handleShowProfile} /></Suspense>;
      case 'leave': return <Suspense fallback={lazyPageFallback}><LeavePanel employees={employees} currentUser={currentUser} requests={leaveRequests} onAction={handleLeaveAction} onAddLeave={handleAddLeave} onViewProfile={handleShowProfile} /></Suspense>;
      case 'admin': return <Suspense fallback={lazyPageFallback}><AdminPanel employees={employees} departments={departments} positions={positions} holidays={holidays} onAddEmployee={handleAddEmployee} onRemoveEmployee={handleRemoveEmployee} onUpdateEmployee={handleUpdateEmployee} onSaveSettings={handleSaveSettings} onViewProfile={handleShowProfile} /></Suspense>;
      case 'profile': return <Suspense fallback={lazyPageFallback}><ProfilePanel currentUser={currentUser} onUpdateProfile={handleUpdateEmployee} /></Suspense>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row selection:bg-indigo-100 selection:text-indigo-900">
      {isMobileMenuOpen && <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden" onClick={() => setIsMobileMenuOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] md:w-64 bg-slate-900 text-white transform transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="h-full flex flex-col p-6">
          <div className="flex items-center gap-3 mb-10 px-2">
            <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center font-bold text-xl shadow-lg shadow-indigo-500/30">H</div>
            <span className="text-xl font-bold tracking-tight">HAND SE</span>
          </div>
          <nav className="flex-1 space-y-1">
            {visibleMenuItems.map(item => (
              <button key={item.id} onClick={() => { navigateToTab(item.id as Tab); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all ${activeTab === item.id ? 'bg-slate-800 text-white shadow-inner' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}>
                <item.icon size={20} />{item.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto pt-6 border-t border-slate-800">
            <button onClick={() => { navigateToTab('profile'); setIsProfileOpen(false); }} className={`w-full flex items-center gap-3 px-2 py-3 rounded-xl transition-all hover:bg-slate-800/50 text-left ${activeTab === 'profile' ? 'bg-slate-800 text-white' : ''}`}>
              <img src={currentUser.avatar} className="w-10 h-10 rounded-full border border-slate-700" alt="" />
              <div className="overflow-hidden flex-1">
                <div className="text-sm font-bold truncate flex items-center gap-1.5">{currentUser.nicknameTh || currentUser.nickname || currentUser.name} {currentUser.role === 'Admin' && <Shield size={10} className="text-rose-500 fill-rose-500" />}</div>
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter flex items-center gap-1">{currentUser.role}</div>
              </div>
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 md:ml-64">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between gap-3 px-3 sm:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="md:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">{isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}</button>
            <h1 className="text-lg font-bold text-slate-800 hidden sm:block">{menuItems.find(m => m.id === activeTab)?.label || 'Page'}</h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="relative" ref={notificationsRef}>
              <button 
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className={`p-2 rounded-xl transition-all relative ${unreadCount > 0 ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100 shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
              >
                <Bell size={20} className={unreadCount > 0 ? 'animate-pulse' : ''} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-white">
                    {unreadCount}
                  </span>
                )}
              </button>

              {isNotificationsOpen && (
                <div className="fixed left-3 right-3 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[340px] bg-white rounded-3xl shadow-2xl border border-slate-100 py-2 animate-in fade-in slide-in-from-top-2 duration-200 z-[100] overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-50 flex items-center justify-between bg-slate-50/30">
                    <h3 className="font-black text-slate-800 text-sm uppercase tracking-tight">Alerts & Notifications</h3>
                    <span className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-[9px] font-black text-indigo-500 uppercase">{unreadCount} New</span>
                  </div>
                  <div className="max-h-[min(400px,calc(100dvh-12rem))] overflow-y-auto custom-scrollbar">
                    {allNotifications.length === 0 ? (
                      <div className="p-10 text-center flex flex-col items-center">
                        <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mb-3"><Check size={24} /></div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-relaxed">No new notifications</p>
                      </div>
                    ) : (
                      allNotifications.map(n => (
                        <button 
                          key={n.id} 
                          onClick={() => handleNotificationClick(n)}
                          className={`w-full text-left p-4 hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors flex items-start gap-4 group ${n.isRead ? 'opacity-60' : 'bg-indigo-50/20'}`}
                        >
                          <div className={`mt-1 p-2 rounded-xl flex-shrink-0 ${
                            n.type === 'checkin' ? 'bg-rose-100 text-rose-600' : 
                            n.type === 'leave' ? (n.title.includes('New') ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600') : 
                            'bg-slate-100 text-slate-500'
                          }`}>
                            {n.type === 'checkin' ? <AlertTriangle size={16} /> : n.type === 'leave' ? (n.title.includes('New') ? <ClipboardList size={16} /> : <CheckCircle2 size={16} />) : <Info size={16} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-black text-slate-800 group-hover:text-indigo-600 transition-colors">{n.title}</p>
                            <p className="text-[11px] text-slate-500 font-medium leading-relaxed mt-0.5">{n.message}</p>
                            <p className="text-[9px] font-bold text-slate-300 uppercase mt-2">{format(new Date(n.timestamp), 'HH:mm • d MMM')}</p>
                          </div>
                          {!n.isRead && <div className="w-2 h-2 rounded-full bg-indigo-500 mt-2"></div>}
                        </button>
                      ))
                    )}
                  </div>
                  {allNotifications.length > 0 && (
                    <div className="p-3 border-t border-slate-50">
                      <button 
                        onClick={handleMarkAllAsRead}
                        className="w-full py-2.5 text-[10px] font-black uppercase text-slate-400 hover:text-indigo-600 transition-colors rounded-xl hover:bg-indigo-50"
                      >
                        Mark all as read
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="relative">
              <button onClick={() => setIsProfileOpen(!isProfileOpen)} className="flex items-center gap-2 p-1 pl-3 bg-slate-50 border border-slate-100 rounded-xl hover:bg-slate-100 transition-colors">
                <div className="text-right hidden sm:block">
                  <div className="text-[10px] font-black text-slate-900 leading-none mb-0.5">{currentUser.nicknameTh || currentUser.nickname || currentUser.name}</div>
                  <div className="text-[8px] font-bold text-slate-400 leading-none uppercase tracking-tighter">{currentUser.role}</div>
                </div>
                <img src={currentUser.avatar} className="w-8 h-8 rounded-lg" alt="" />
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} />
              </button>
              {isProfileOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-100 py-3 animate-in fade-in slide-in-from-top-2 duration-200 z-[100]">
                  <div className="px-4 py-2 border-b border-slate-50 mb-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active User</p>
                    <p className="text-xs font-black text-slate-800 truncate">{currentUser.nicknameTh || currentUser.nickname || currentUser.name}</p>
                  </div>
                  <button onClick={() => { navigateToTab('profile'); setIsProfileOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors px-4"><User size={14} /> My Profile Settings</button>
                  <div className="mt-2 pt-2 border-t border-slate-50"><button onClick={handleLogout} className="w-full flex items-center gap-2 px-4 py-2 text-xs font-bold text-rose-500 hover:bg-rose-50 transition-colors"><LogOut size={14} /> Sign Out</button></div>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="p-4 sm:p-6 xl:p-8 animate-in fade-in duration-500">{renderContent()}</div>
      </main>
      {selectedProfileUser && <UserProfileModal user={selectedProfileUser} onClose={() => setSelectedProfileUser(null)} />}
    </div>
  );
};
export default App;
