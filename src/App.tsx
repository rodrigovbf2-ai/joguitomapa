import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { Upload } from 'lucide-react';
import { AdminPanelView } from './components/AdminPanelView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FloorPlanCanvas } from './components/FloorPlanCanvas';
import { NewUnitModal } from './components/NewUnitModal';
import { UnitInspectorPanel } from './components/UnitInspectorPanel';
import { UnitsTableView } from './components/UnitsTableView';
import {
  SAMPLE_DEVELOPMENT_ID,
  SAMPLE_DEVELOPMENT_TEMPLATE,
  SAMPLE_UNITS_TEMPLATE,
} from './data/defaultDevelopment';
import { auth, BOOTSTRAP_ADMIN_EMAIL, db, googleProvider } from './lib/firebase';
import { processFloorPlanImage } from './lib/imageCompression';
import {
  batchUpdateUnitStatus,
  createDevelopment,
  createUnit,
  deleteUnit,
  saveUnitPrivateNote,
  seedSampleDevelopment,
  subscribeActivityLogs,
  subscribeDevelopments,
  subscribeUnitNotes,
  subscribeUnits,
  updateDevelopmentDetails,
  updateUnitDetails,
  updateUnitStatus,
} from './lib/propertyService';
import {
  formatCurrencyEUR,
  type ActivityLog,
  type Development,
  type Unit,
  type UnitPrivateNote,
  type UnitStatus,
} from './types/property';

type ActiveTab = 'planta' | 'tabela' | 'admin';

function buildLocalPreviewUnits(): Unit[] {
  return SAMPLE_UNITS_TEMPLATE.map((u) => ({
    ...u,
    developmentId: SAMPLE_DEVELOPMENT_ID,
    ownerId: 'demo_preview',
  }));
}

function MainApp() {
  const quickUploadRef = useRef<HTMLInputElement | null>(null);

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('planta');
  const [statusFilter, setStatusFilter] = useState<UnitStatus | 'todas'>('todas');

  const [developments, setDevelopments] = useState<Development[]>([]);
  const [developmentsLoaded, setDevelopmentsLoaded] = useState(false);
  const [activeDevelopmentId, setActiveDevelopmentId] = useState<string | null>(null);

  const [firestoreUnits, setFirestoreUnits] = useState<Unit[]>([]);
  const [unitNotesMap, setUnitNotesMap] = useState<Record<string, UnitPrivateNote>>({});
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  // Local interactive preview state used only before any development is persisted in Firestore
  const [previewDev, setPreviewDev] = useState<Development>({
    ...SAMPLE_DEVELOPMENT_TEMPLATE,
  });
  const [previewUnits, setPreviewUnits] = useState<Unit[]>(buildLocalPreviewUnits);

  const [selectedUnitId, setSelectedUnitId] = useState<string | null>('fracao_a');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [isRepositionMode, setIsRepositionMode] = useState(false);
  const [newUnitModalOpen, setNewUnitModalOpen] = useState(false);
  const [drawnRect, setDrawnRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  // 1. Auth Listener & Admin Privilege Verification
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser && currentUser.emailVerified) {
        if (currentUser.email === BOOTSTRAP_ADMIN_EMAIL) {
          setIsSuperAdmin(true);
        } else {
          try {
            const adminSnap = await getDoc(doc(db, 'admins', currentUser.uid));
            setIsSuperAdmin(adminSnap.exists());
          } catch {
            setIsSuperAdmin(false);
          }
        }
      } else {
        setIsSuperAdmin(false);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // 2. Real-time Developments Listener
  useEffect(() => {
    if (!authReady) return;
    const unsub = subscribeDevelopments(user?.uid ?? null, isSuperAdmin, (list) => {
      setDevelopments(list);
      setDevelopmentsLoaded(true);
      setActiveDevelopmentId((prev) => {
        if (prev && list.some((d) => d.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    });
    return () => unsub();
  }, [authReady, user?.uid, isSuperAdmin]);

  const usingPreview = developmentsLoaded && developments.length === 0;
  const activeDevelopment = useMemo(() => {
    if (usingPreview) return previewDev;
    return developments.find((d) => d.id === activeDevelopmentId) ?? developments[0] ?? null;
  }, [usingPreview, previewDev, developments, activeDevelopmentId]);

  const units = usingPreview ? previewUnits : firestoreUnits;

  // 3. Real-time Units Listener for Active Development
  useEffect(() => {
    if (!authReady || usingPreview || !activeDevelopment?.id) {
      setFirestoreUnits([]);
      return;
    }
    const unsub = subscribeUnits(activeDevelopment.id, (list) => {
      setFirestoreUnits(list);
      setSelectedUnitId((prev) => {
        if (prev && list.some((u) => u.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    });
    return () => unsub();
  }, [authReady, usingPreview, activeDevelopment?.id]);

  // 4. Can current user persist edits in Firestore?
  const canEditFirestore = Boolean(
    user &&
      user.emailVerified &&
      activeDevelopment &&
      (isSuperAdmin || activeDevelopment.ownerId === user.uid),
  );

  // In preview mode (before DB has any developments), allow interactive testing + upload locally;
  // once DB has developments, require authorized Google session to persist real-time changes.
  const canEdit = usingPreview ? true : canEditFirestore;

  // 5. Real-time Private Notes & Activity Logs (Admin/Owner Only)
  useEffect(() => {
    if (!authReady || usingPreview || !activeDevelopment?.id || !canEditFirestore) {
      setUnitNotesMap({});
      setActivityLogs([]);
      return;
    }
    const unsubNotes = subscribeUnitNotes(activeDevelopment.id, setUnitNotesMap);
    const unsubLogs = subscribeActivityLogs(activeDevelopment.id, setActivityLogs);
    return () => {
      unsubNotes();
      unsubLogs();
    };
  }, [authReady, usingPreview, activeDevelopment?.id, canEditFirestore]);

  const selectedUnit = useMemo(
    () => units.find((u) => u.id === selectedUnitId) ?? null,
    [units, selectedUnitId],
  );

  // Summary KPIs
  const metrics = useMemo(() => {
    const total = units.length;
    const disponivel = units.filter((u) => u.status === 'disponivel').length;
    const reservado = units.filter((u) => u.status === 'reservado').length;
    const vendido = units.filter((u) => u.status === 'vendido').length;
    const availableValue = units
      .filter((u) => u.status === 'disponivel')
      .reduce((sum, u) => sum + u.price, 0);
    return { total, disponivel, reservado, vendido, availableValue };
  }, [units]);

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (developmentsLoaded && developments.length === 0 && cred.user) {
        const seededId = await seedSampleDevelopment(
          cred.user.uid,
          cred.user.displayName || cred.user.email || 'Administrador',
        );
        setActiveDevelopmentId(seededId);
        setBannerMessage('Sessão iniciada e planta inicial sincronizada na base de dados.');
        setTimeout(() => setBannerMessage(null), 4000);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError('Não foi possível concluir a autenticação Google.');
      }
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setIsDrawMode(false);
    setIsRepositionMode(false);
  };

  const handleSeedSample = async () => {
    if (!user) {
      await handleSignIn();
      return;
    }
    setIsUpdating(true);
    try {
      const newId = await seedSampleDevelopment(
        user.uid,
        user.displayName || user.email || 'Administrador',
      );
      setActiveDevelopmentId(newId);
      setBannerMessage('Empreendimento de demonstração criado na base de dados.');
      setTimeout(() => setBannerMessage(null), 3500);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleChangeUnitStatus = async (unit: Unit, newStatus: UnitStatus) => {
    if (usingPreview) {
      setPreviewUnits((prev) =>
        prev.map((u) => (u.id === unit.id ? { ...u, status: newStatus } : u)),
      );
      return;
    }
    if (!user || !activeDevelopment) {
      await handleSignIn();
      return;
    }
    setIsUpdating(true);
    try {
      await updateUnitStatus({
        developmentId: activeDevelopment.id,
        unit,
        newStatus,
        actorUid: user.uid,
        actorName: user.displayName || user.email || 'Administrador',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleBatchChangeStatus = async (targetUnits: Unit[], newStatus: UnitStatus) => {
    if (usingPreview) {
      const ids = new Set(targetUnits.map((u) => u.id));
      setPreviewUnits((prev) =>
        prev.map((u) => (ids.has(u.id) ? { ...u, status: newStatus } : u)),
      );
      return;
    }
    if (!user || !activeDevelopment) return;
    setIsUpdating(true);
    try {
      await batchUpdateUnitStatus({
        developmentId: activeDevelopment.id,
        units: targetUnits,
        newStatus,
        actorUid: user.uid,
        actorName: user.displayName || user.email || 'Administrador',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveUnitDetails = async (
    unitId: string,
    updates: {
      code: string;
      typology: string;
      floor: string;
      areaSqm: number;
      price: number;
      orientation: string;
      status: UnitStatus;
      x: number;
      y: number;
      width: number;
      height: number;
    },
  ) => {
    if (usingPreview) {
      setPreviewUnits((prev) =>
        prev.map((u) => (u.id === unitId ? { ...u, ...updates } : u)),
      );
      return;
    }
    if (!activeDevelopment) return;
    setIsUpdating(true);
    try {
      await updateUnitDetails(activeDevelopment.id, unitId, updates);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleMoveUnit = async (unit: Unit, newX: number, newY: number) => {
    await handleSaveUnitDetails(unit.id, {
      code: unit.code,
      typology: unit.typology,
      floor: unit.floor,
      areaSqm: unit.areaSqm,
      price: unit.price,
      orientation: unit.orientation,
      status: unit.status,
      x: newX,
      y: newY,
      width: unit.width,
      height: unit.height,
    });
  };

  const handleCreateUnit = async (data: {
    code: string;
    typology: string;
    floor: string;
    areaSqm: number;
    price: number;
    orientation: string;
    status: UnitStatus;
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    if (usingPreview) {
      const newId = `unit_${Date.now()}`;
      setPreviewUnits((prev) => [
        ...prev,
        {
          id: newId,
          developmentId: SAMPLE_DEVELOPMENT_ID,
          ownerId: 'demo_preview',
          ...data,
        },
      ]);
      setSelectedUnitId(newId);
      setIsDrawMode(false);
      return;
    }
    if (!user || !activeDevelopment) return;
    setIsUpdating(true);
    try {
      const newId = await createUnit({
        developmentId: activeDevelopment.id,
        ownerId: activeDevelopment.ownerId,
        actorUid: user.uid,
        actorName: user.displayName || user.email || 'Administrador',
        ...data,
      });
      setSelectedUnitId(newId);
      setIsDrawMode(false);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteUnit = async (unitId: string) => {
    if (usingPreview) {
      setPreviewUnits((prev) => prev.filter((u) => u.id !== unitId));
      setSelectedUnitId(null);
      return;
    }
    if (!activeDevelopment) return;
    setIsUpdating(true);
    try {
      await deleteUnit(activeDevelopment.id, unitId);
      setSelectedUnitId(null);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveNote = async (
    unit: Unit,
    note: { buyerName: string; buyerContact: string; notes: string },
  ) => {
    if (usingPreview) {
      setBannerMessage('Inicie sessão como administrador para guardar notas privadas na base de dados.');
      setTimeout(() => setBannerMessage(null), 3500);
      return;
    }
    if (!activeDevelopment) return;
    await saveUnitPrivateNote({
      developmentId: activeDevelopment.id,
      unitId: unit.id,
      ownerId: activeDevelopment.ownerId,
      buyerName: note.buyerName,
      buyerContact: note.buyerContact,
      notes: note.notes,
      existsAlready: Boolean(unitNotesMap[unit.id]),
    });
  };

  const handleUpdateDevelopment = async (updates: {
    name?: string;
    subtitle?: string;
    floorLabel?: string;
    floorPlanUrl?: string;
    isPublished?: boolean;
  }) => {
    if (usingPreview) {
      setPreviewDev((prev) => ({ ...prev, ...updates }));
      return;
    }
    if (!activeDevelopment) return;
    await updateDevelopmentDetails(activeDevelopment.id, updates);
  };

  const handleCreateDevelopment = async (input: {
    name: string;
    subtitle: string;
    floorLabel: string;
    floorPlanUrl: string;
  }) => {
    if (!user) {
      await handleSignIn();
      return;
    }
    const newId = await createDevelopment({
      ...input,
      ownerId: user.uid,
    });
    setActiveDevelopmentId(newId);
    setSelectedUnitId(null);
    setActiveTab('planta');
  };

  const handleQuickFloorPlanUpload = async (file: File) => {
    setAuthError(null);
    try {
      const optimizedUrl = await processFloorPlanImage(file);
      await handleUpdateDevelopment({ floorPlanUrl: optimizedUrl });
      setBannerMessage('Nova planta inserida com sucesso.');
      setTimeout(() => setBannerMessage(null), 3000);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Erro ao processar a imagem.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Navigation Bar: Strict 3-Zone Contract */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('planta')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            PlantaViva
          </button>

          {/* Zone 2: Clean single-line navigation links */}
          <nav className="flex items-center gap-6 overflow-x-auto" aria-label="Navegação principal">
            <button
              type="button"
              onClick={() => setActiveTab('planta')}
              className={`py-5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'planta'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Planta Interativa
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tabela')}
              className={`py-5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'tabela'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Tabela de Frações
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('admin')}
              className={`py-5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'admin'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Painel Administrativo
            </button>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="shrink-0">
            {user ? (
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="px-4 py-2 text-xs font-semibold text-slate-900 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Terminar Sessão
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSignIn()}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Entrar como Admin
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Notifications */}
        {authError && (
          <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-800 flex items-center justify-between gap-4">
            <span>{authError}</span>
            <button
              type="button"
              onClick={() => setAuthError(null)}
              className="underline cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        {bannerMessage && (
          <div className="px-4 py-3 rounded-xl bg-slate-900 text-white text-xs font-medium flex items-center justify-between gap-4">
            <span>{bannerMessage}</span>
            <button
              type="button"
              onClick={() => setBannerMessage(null)}
              className="text-slate-300 hover:text-white underline cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        {usingPreview && (
          <div className="px-4 py-3 rounded-xl bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-600">
              Pré-visualização interativa ativa. Para guardar plantas e sincronizar alterações em tempo real entre dispositivos, inicie sessão como administrador.
            </p>
            <button
              type="button"
              onClick={() => void handleSignIn()}
              className="px-3.5 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sincronizar com Conta Google
            </button>
          </div>
        )}

        {/* Development Header & Workspace Toolbar */}
        <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{activeDevelopment?.floorLabel ?? 'Piso 1'}</span>
              <span aria-hidden="true">·</span>
              <span>{usingPreview ? 'Pré-visualização local' : 'Sincronizado em tempo real'}</span>
              {user && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{user.email}</span>
                </>
              )}
            </div>
            <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              {activeDevelopment?.name ?? 'Empreendimento'}
            </h1>
            {activeDevelopment?.subtitle && (
              <p className="mt-0.5 text-sm text-slate-600">{activeDevelopment.subtitle}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {developments.length > 1 && (
              <select
                aria-label="Selecionar empreendimento ou piso"
                value={activeDevelopment?.id ?? ''}
                onChange={(e) => {
                  setActiveDevelopmentId(e.target.value);
                  setSelectedUnitId(null);
                }}
                className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900"
              >
                {developments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.floorLabel})
                  </option>
                ))}
              </select>
            )}

            {canEdit && (
              <>
                <input
                  ref={quickUploadRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void handleQuickFloorPlanUpload(file);
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => quickUploadRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-white border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Inserir Planta</span>
                </button>
              </>
            )}

            {/* Status Filter Segmented Control */}
            {activeTab === 'planta' && (
              <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
                {(
                  [
                    { id: 'todas', label: 'Todas' },
                    { id: 'disponivel', label: 'Disponível' },
                    { id: 'reservado', label: 'Reservado' },
                    { id: 'vendido', label: 'Vendido' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStatusFilter(item.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      statusFilter === item.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 4-Column KPI Summary Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Total de Frações</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 font-mono tabular-nums">
              {metrics.total}
            </p>
            <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              Oferta: {formatCurrencyEUR(metrics.availableValue)}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-green-700">Disponíveis (Verde)</p>
            <p className="mt-1 text-2xl font-bold text-green-700 font-mono tabular-nums">
              {metrics.disponivel}
            </p>
            <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              {metrics.total > 0 ? Math.round((metrics.disponivel / metrics.total) * 100) : 0}% do total
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-blue-700">Reservadas (Azul)</p>
            <p className="mt-1 text-2xl font-bold text-blue-700 font-mono tabular-nums">
              {metrics.reservado}
            </p>
            <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              {metrics.total > 0 ? Math.round((metrics.reservado / metrics.total) * 100) : 0}% do total
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-red-700">Vendidas (Vermelho)</p>
            <p className="mt-1 text-2xl font-bold text-red-700 font-mono tabular-nums">
              {metrics.vendido}
            </p>
            <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              {metrics.total > 0 ? Math.round((metrics.vendido / metrics.total) * 100) : 0}% do total
            </p>
          </div>
        </section>

        {/* Active View Workspace */}
        {activeTab === 'planta' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8">
              <FloorPlanCanvas
                floorPlanUrl={activeDevelopment?.floorPlanUrl ?? ''}
                developmentName={activeDevelopment?.name ?? 'Empreendimento'}
                units={units}
                selectedUnitId={selectedUnitId}
                statusFilter={statusFilter}
                canEdit={canEdit}
                isDrawMode={isDrawMode}
                isRepositionMode={isRepositionMode}
                onToggleDrawMode={() => {
                  setIsDrawMode((v) => !v);
                  setIsRepositionMode(false);
                }}
                onToggleRepositionMode={() => {
                  setIsRepositionMode((v) => !v);
                  setIsDrawMode(false);
                }}
                onSelectUnit={(id) => setSelectedUnitId(id)}
                onFinishDraw={(rect) => {
                  setDrawnRect(rect);
                  setNewUnitModalOpen(true);
                }}
                onMoveUnit={(unit, x, y) => void handleMoveUnit(unit, x, y)}
              />
            </div>

            <div className="lg:col-span-4">
              <UnitInspectorPanel
                selectedUnit={selectedUnit}
                units={units}
                privateNote={selectedUnit ? unitNotesMap[selectedUnit.id] : undefined}
                canEdit={canEdit}
                isUpdating={isUpdating}
                onSelectUnit={(id) => setSelectedUnitId(id)}
                onChangeStatus={handleChangeUnitStatus}
                onSaveDetails={handleSaveUnitDetails}
                onSaveNote={handleSaveNote}
                onDeleteUnit={handleDeleteUnit}
                onSignIn={() => void handleSignIn()}
              />
            </div>
          </div>
        )}

        {activeTab === 'tabela' && (
          <UnitsTableView
            units={units}
            canEdit={canEdit}
            onSelectAndViewOnPlan={(id) => {
              setSelectedUnitId(id);
              setActiveTab('planta');
            }}
            onChangeStatus={handleChangeUnitStatus}
          />
        )}

        {activeTab === 'admin' && (
          <AdminPanelView
            activeDevelopment={activeDevelopment}
            units={units}
            activityLogs={activityLogs}
            canEdit={canEdit}
            onSignIn={() => void handleSignIn()}
            onUpdateDevelopment={handleUpdateDevelopment}
            onCreateDevelopment={handleCreateDevelopment}
            onChangeUnitStatus={handleChangeUnitStatus}
            onBatchChangeStatus={handleBatchChangeStatus}
            onOpenNewUnitModal={() => {
              setDrawnRect({ x: 42, y: 42, width: 14, height: 16 });
              setNewUnitModalOpen(true);
            }}
            onViewUnitOnPlan={(id) => {
              setSelectedUnitId(id);
              setActiveTab('planta');
            }}
            onSeedSample={handleSeedSample}
          />
        )}
      </main>

      <NewUnitModal
        isOpen={newUnitModalOpen}
        defaultFloor={activeDevelopment?.floorLabel ?? 'Piso 1'}
        initialRect={drawnRect}
        onClose={() => {
          setNewUnitModalOpen(false);
          setDrawnRect(null);
        }}
        onCreate={handleCreateUnit}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
