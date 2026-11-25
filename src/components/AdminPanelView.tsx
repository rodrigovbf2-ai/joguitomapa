import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CheckSquare, ImagePlus, Plus, Square, Upload } from 'lucide-react';
import { processFloorPlanImage } from '../lib/imageCompression';
import {
  formatArea,
  formatCurrencyEUR,
  STATUS_META,
  type ActivityLog,
  type Development,
  type Unit,
  type UnitStatus,
} from '../types/property';

interface AdminPanelViewProps {
  activeDevelopment: Development | null;
  units: Unit[];
  activityLogs: ActivityLog[];
  canEdit: boolean;
  onSignIn: () => void;
  onUpdateDevelopment: (updates: {
    name?: string;
    subtitle?: string;
    floorLabel?: string;
    floorPlanUrl?: string;
    isPublished?: boolean;
  }) => Promise<void>;
  onCreateDevelopment: (input: {
    name: string;
    subtitle: string;
    floorLabel: string;
    floorPlanUrl: string;
  }) => Promise<void>;
  onChangeUnitStatus: (unit: Unit, status: UnitStatus) => Promise<void>;
  onBatchChangeStatus: (units: Unit[], status: UnitStatus) => Promise<void>;
  onOpenNewUnitModal: () => void;
  onViewUnitOnPlan: (unitId: string) => void;
  onSeedSample?: () => Promise<void>;
}

export function AdminPanelView({
  activeDevelopment,
  units,
  activityLogs,
  canEdit,
  onSignIn,
  onUpdateDevelopment,
  onCreateDevelopment,
  onChangeUnitStatus,
  onBatchChangeStatus,
  onOpenNewUnitModal,
  onViewUnitOnPlan,
  onSeedSample,
}: AdminPanelViewProps) {
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const newDevFileInputRef = useRef<HTMLInputElement | null>(null);

  const [devName, setDevName] = useState(activeDevelopment?.name ?? '');
  const [devSubtitle, setDevSubtitle] = useState(activeDevelopment?.subtitle ?? '');
  const [devFloorLabel, setDevFloorLabel] = useState(activeDevelopment?.floorLabel ?? '');
  const [uploadStatusMsg, setUploadStatusMsg] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [savingDev, setSavingDev] = useState(false);

  const [showNewDevForm, setShowNewDevForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSubtitle, setNewSubtitle] = useState('');
  const [newFloor, setNewFloor] = useState('Piso 2');
  const [newFloorPlanUrl, setNewFloorPlanUrl] = useState('');
  const [newDevError, setNewDevError] = useState<string | null>(null);
  const [creatingDev, setCreatingDev] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Keep local form synchronized when user switches active development
  const [syncedDevId, setSyncedDevId] = useState<string | null>(null);
  if (activeDevelopment && activeDevelopment.id !== syncedDevId) {
    setSyncedDevId(activeDevelopment.id);
    setDevName(activeDevelopment.name);
    setDevSubtitle(activeDevelopment.subtitle);
    setDevFloorLabel(activeDevelopment.floorLabel);
    setSelectedIds([]);
  }

  const handleReplaceFloorPlan = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeDevelopment) return;

    setUploadError(null);
    setUploadStatusMsg('A processar e enviar planta...');
    try {
      const optimizedUrl = await processFloorPlanImage(file);
      await onUpdateDevelopment({ floorPlanUrl: optimizedUrl });
      setUploadStatusMsg('Planta atualizada em tempo real.');
      setTimeout(() => setUploadStatusMsg(null), 3000);
    } catch (err) {
      setUploadStatusMsg(null);
      setUploadError(err instanceof Error ? err.message : 'Erro ao carregar a planta.');
    }
  };

  const handleNewDevFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNewDevError(null);
    try {
      const optimizedUrl = await processFloorPlanImage(file);
      setNewFloorPlanUrl(optimizedUrl);
    } catch (err) {
      setNewDevError(err instanceof Error ? err.message : 'Erro ao carregar a imagem da planta.');
    }
  };

  const handleSaveDevDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeDevelopment) return;
    setSavingDev(true);
    setUploadError(null);
    try {
      await onUpdateDevelopment({
        name: devName,
        subtitle: devSubtitle,
        floorLabel: devFloorLabel,
      });
      setUploadStatusMsg('Dados do empreendimento guardados.');
      setTimeout(() => setUploadStatusMsg(null), 2500);
    } finally {
      setSavingDev(false);
    }
  };

  const handleCreateNewDev = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newFloorPlanUrl) {
      setNewDevError('Indique o nome do empreendimento e carregue uma imagem da planta.');
      return;
    }
    setCreatingDev(true);
    setNewDevError(null);
    try {
      await onCreateDevelopment({
        name: newName.trim(),
        subtitle: newSubtitle.trim(),
        floorLabel: newFloor.trim() || 'Piso 1',
        floorPlanUrl: newFloorPlanUrl,
      });
      setNewName('');
      setNewSubtitle('');
      setNewFloor('Piso 2');
      setNewFloorPlanUrl('');
      setShowNewDevForm(false);
    } catch (err) {
      setNewDevError(err instanceof Error ? err.message : 'Erro ao criar empreendimento.');
    } finally {
      setCreatingDev(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === units.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(units.map((u) => u.id));
    }
  };

  const toggleSelectUnit = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const selectedUnits = units.filter((u) => selectedIds.includes(u.id));

  if (!canEdit) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-2xl mx-auto text-center space-y-4">
        <h2 className="text-xl font-bold text-slate-900">
          Painel Administrativo de Gestão
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Para inserir novas plantas de empreendimentos, mapear frações ou alterar estados de disponibilidade (Disponível, Reservado, Vendido) em tempo real, inicie sessão com a sua conta Google autorizada.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={onSignIn}
            className="px-5 py-2.5 text-sm font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Entrar como Administrador
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section 1: Floor Plan & Development Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Configuração do Empreendimento e Planta
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Carregue a planta arquitetónica e atualize a identificação do piso selecionado.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewDevForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showNewDevForm ? 'Fechar Novo Piso' : 'Novo Empreendimento / Piso'}</span>
            </button>
          </div>

          {showNewDevForm && (
            <form
              onSubmit={handleCreateNewDev}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
            >
              <h3 className="text-sm font-semibold text-slate-900">
                Adicionar Novo Empreendimento ou Piso
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-slate-700">Nome</span>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    placeholder="Ex: Edifício Miradouro — Piso 2"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">Piso</span>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={newFloor}
                    onChange={(e) => setNewFloor(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-slate-900"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-700">Localização / Subtítulo</span>
                <input
                  type="text"
                  maxLength={180}
                  placeholder="Ex: Avenida da Boavista, Porto"
                  value={newSubtitle}
                  onChange={(e) => setNewSubtitle(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-slate-900"
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3">
                  <input
                    ref={newDevFileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleNewDevFile}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => newDevFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer"
                  >
                    <ImagePlus className="w-4 h-4" />
                    <span>{newFloorPlanUrl ? 'Planta carregada (alterar)' : 'Inserir Imagem da Planta'}</span>
                  </button>
                  {newFloorPlanUrl && (
                    <span className="text-xs font-medium text-green-700">Imagem pronta</span>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={creatingDev}
                  className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                >
                  {creatingDev ? 'A criar...' : 'Guardar Novo Piso'}
                </button>
              </div>

              {newDevError && (
                <p className="text-xs text-red-700 font-medium">{newDevError}</p>
              )}
            </form>
          )}

          {activeDevelopment ? (
            <form onSubmit={handleSaveDevDetails} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-slate-700">Nome do Empreendimento</span>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={devName}
                    onChange={(e) => setDevName(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">Piso</span>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={devFloorLabel}
                    onChange={(e) => setDevFloorLabel(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-slate-900"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-medium text-slate-700">Descrição / Morada</span>
                <input
                  type="text"
                  maxLength={180}
                  value={devSubtitle}
                  onChange={(e) => setDevSubtitle(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-slate-900"
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={replaceFileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleReplaceFloorPlan}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => replaceFileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Inserir / Substituir Planta</span>
                  </button>

                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeDevelopment.isPublished}
                      onChange={(e) =>
                        void onUpdateDevelopment({ isPublished: e.target.checked })
                      }
                      className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span>Visível ao público</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={savingDev}
                  className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                >
                  {savingDev ? 'A guardar...' : 'Guardar Dados'}
                </button>
              </div>

              {uploadStatusMsg && (
                <p className="text-xs font-medium text-green-700">{uploadStatusMsg}</p>
              )}
              {uploadError && (
                <p className="text-xs font-medium text-red-700">{uploadError}</p>
              )}
            </form>
          ) : (
            <div className="py-6 text-center space-y-3">
              <p className="text-sm text-slate-600">
                Ainda não existe nenhum empreendimento gravado na base de dados.
              </p>
              {onSeedSample && (
                <button
                  type="button"
                  onClick={() => void onSeedSample()}
                  className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  Carregar Planta de Demonstração (Edifício Miradouro)
                </button>
              )}
            </div>
          )}
        </div>

        {/* Section 2: Real-Time Activity Log */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Registo de Alterações em Tempo Real
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Histórico automático das mudanças de disponibilidade das frações.
            </p>
          </div>

          {activityLogs.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center border-t border-slate-200">
              As alterações de estado aparecerão aqui em tempo real.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 max-h-[300px] overflow-y-auto border-t border-slate-200">
              {activityLogs.map((log) => {
                const newMeta = STATUS_META[log.newStatus];
                const prevLabel =
                  log.previousStatus === 'novo'
                    ? 'Criada'
                    : STATUS_META[log.previousStatus].label;

                return (
                  <div key={log.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {log.unitCode}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {prevLabel} → {newMeta.label} · {log.actorName}
                      </p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold shrink-0 ${newMeta.softBadge}`}>
                      {newMeta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Section 3: Fast Admin Table with 1-Click Color Controls & Batch Operations */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Gestão Direta de Frações
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Clique num estado para atualizar a cor na planta instantaneamente: Verde (Disponível), Azul (Reservado) ou Vermelho (Vendido).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedUnits.length > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 rounded-lg">
                <span className="text-xs font-medium text-slate-700 mr-1">
                  {selectedUnits.length} selecionadas:
                </span>
                {(['disponivel', 'reservado', 'vendido'] as UnitStatus[]).map((statusKey) => {
                  const meta = STATUS_META[statusKey];
                  return (
                    <button
                      key={statusKey}
                      type="button"
                      onClick={() => {
                        void onBatchChangeStatus(selectedUnits, statusKey);
                        setSelectedIds([]);
                      }}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded cursor-pointer ${meta.solidButton}`}
                    >
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            )}

            {activeDevelopment && (
              <button
                type="button"
                onClick={onOpenNewUnitModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Adicionar Fração</span>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4 w-10">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    aria-label="Selecionar todas as frações"
                    className="text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    {units.length > 0 && selectedIds.length === units.length ? (
                      <CheckSquare className="w-4 h-4 text-slate-900" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="py-3 px-4">Fração</th>
                <th className="py-3 px-4">Tipologia</th>
                <th className="py-3 px-4 text-right">Área</th>
                <th className="py-3 px-4 text-right">Valor</th>
                <th className="py-3 px-4">Estado em Tempo Real</th>
                <th className="py-3 px-4 text-right">Planta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {units.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-slate-500">
                    Sem frações registadas nesta planta. Adicione uma fração ou mapeie diretamente sobre a planta.
                  </td>
                </tr>
              ) : (
                units.map((unit) => {
                  const isChecked = selectedIds.includes(unit.id);
                  return (
                    <tr key={unit.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          onClick={() => toggleSelectUnit(unit.id)}
                          aria-label={`Selecionar ${unit.code}`}
                          className="text-slate-500 hover:text-slate-900 cursor-pointer"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-slate-900" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{unit.code}</td>
                      <td className="py-2.5 px-4 text-slate-700">
                        {unit.typology} · {unit.floor}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                        {formatArea(unit.areaSqm)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                        {formatCurrencyEUR(unit.price)}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="inline-flex items-center gap-1.5">
                          {(['disponivel', 'reservado', 'vendido'] as UnitStatus[]).map(
                            (statusKey) => {
                              const meta = STATUS_META[statusKey];
                              const active = unit.status === statusKey;
                              return (
                                <button
                                  key={statusKey}
                                  type="button"
                                  onClick={() => void onChangeUnitStatus(unit, statusKey)}
                                  className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                                    active ? meta.activeButton : meta.outlineButton
                                  }`}
                                >
                                  {meta.label}
                                </button>
                              );
                            },
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onViewUnitOnPlan(unit.id)}
                          className="text-xs font-medium text-slate-700 hover:text-slate-900 underline cursor-pointer"
                        >
                          Abrir na planta
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
