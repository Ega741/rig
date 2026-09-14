import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address, Hex } from 'viem';
import { ViemChainReader, ViemHarvester, ViemSubmitter, createClients, ethReward, type ChainClients } from '../chain/hashMineChain';
import { CpuEngine } from '../engine/cpuEngine';
import { GpuEngine } from '../engine/gpuEngine';
import type { Engine } from '../engine/types';
import { MAX_INTENSITY, MinerController, clampIntensity, type MinerEvent, type Snapshot } from '../miner/controller';
import { SessionKey } from '../session/sessionKey';
import type { UiConfig } from './config';

export interface MinerSettings {
  cores: number;
  useGpu: boolean;
  /** Duty cycle in percent; the controller caps it at MAX_INTENSITY. */
  intensity: number;
}

/** At most half of the machine's cores. */
export function maxCores(): number {
  return Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2));
}

export interface Mark {
  at: number;
  kind: 'hit' | 'submit';
}

const SETTINGS_KEY = 'rig.settings';
const HARVEST_CHECK_MS = 30_000;

function defaultSettings(): MinerSettings {
  return { cores: maxCores(), useGpu: true, intensity: MAX_INTENSITY };
}

function loadSettings(): MinerSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const merged = { ...defaultSettings(), ...(JSON.parse(raw) as Partial<MinerSettings>) };
      return { ...merged, cores: Math.min(merged.cores, maxCores()), intensity: clampIntensity(merged.intensity) };
    }
  } catch {
    /* ignore a corrupted value */
  }
  return defaultSettings();
}

const IDLE_POLL_MS = 10_000;

export function useMiner(config: UiConfig, beneficiary: Address | null) {
  const sessionKey = useMemo(() => SessionKey.loadOrCreate(localStorage), []);
  const clients = useMemo<ChainClients>(() => createClients(config.chain, config.rpcUrl, sessionKey.account), [config, sessionKey]);
  const [settings, setSettingsState] = useState<MinerSettings>(loadSettings);
  const [running, setRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  /** Round and pool as read from the chain while no miner runs, so the page is never blank before Start. */
  const [chainView, setChainView] = useState<Snapshot | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [lastShare, setLastShare] = useState<{ hash: Hex; bits: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sessionBalance, setSessionBalance] = useState<bigint | null>(null);
  const [gpuName, setGpuName] = useState<string | null>(null);
  const gpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;

  const controllerRef = useRef<MinerController | null>(null);
  const enginesRef = useRef<Engine[]>([]);
  const harvesterRef = useRef<ViemHarvester | null>(null);

  const setSettings = useCallback((next: MinerSettings) => {
    const clamped = { ...next, cores: Math.min(Math.max(0, next.cores), maxCores()), intensity: clampIntensity(next.intensity) };
    setSettingsState(clamped);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(clamped));
    controllerRef.current?.setIntensity(clamped.intensity);
  }, []);

  const refreshBalance = useCallback(async () => {
    try {
      setSessionBalance(await clients.publicClient.getBalance({ address: sessionKey.address }));
    } catch {
      setSessionBalance(null);
    }
  }, [clients, sessionKey]);

  useEffect(() => {
    void refreshBalance();
    const timer = setInterval(() => void refreshBalance(), 10_000);
    return () => clearInterval(timer);
  }, [refreshBalance]);

  const stop = useCallback(() => {
    controllerRef.current?.stop();
    controllerRef.current = null;
    for (const engine of enginesRef.current) engine.stop();
    enginesRef.current = [];
    setRunning(false);
    setStatus('Stopped.');
  }, []);

  const start = useCallback(async () => {
    if (!beneficiary) {
      setStatus('Choose where rewards go first.');
      return;
    }
    if (controllerRef.current) return;
    setStatus('Starting engines…');
    const engines: Engine[] = [];
    if (settings.cores > 0) engines.push(new CpuEngine(settings.cores));
    if (settings.useGpu && gpuAvailable) {
      try {
        const gpu = await GpuEngine.create();
        if (gpu) {
          engines.push(gpu);
          setGpuName([gpu.adapterInfo.vendor, gpu.adapterInfo.architecture].filter(Boolean).join(' ') || 'GPU');
        }
      } catch (error) {
        setStatus(`GPU unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (engines.length === 0) {
      setStatus('No engine selected: enable CPU cores or the GPU.');
      return;
    }
    const controller = new MinerController({
      beneficiary,
      engines,
      chain: new ViemChainReader(clients.publicClient, config.hashMine),
      submitter: new ViemSubmitter(clients, config.hashMine, sessionKey.account),
      price: ethReward,
      intensity: settings.intensity,
    });
    controller.onSnapshot = (s) => setSnapshot(s);
    controller.onEvent = (event: MinerEvent) => {
      if (event.type === 'round') setMarks([]);
      else setMarks((m) => [...m.slice(-400), { at: event.at, kind: event.type }]);
      if (event.type === 'hit') setLastShare({ hash: event.hash, bits: event.bits });
    };
    enginesRef.current = engines;
    controllerRef.current = controller;
    harvesterRef.current =
      config.treasury && config.feeEscrow ? new ViemHarvester(clients, config.treasury, config.feeEscrow, sessionKey.account) : null;
    controller.start(2000);
    setRunning(true);
    setStatus('Mining.');
  }, [beneficiary, settings, gpuAvailable, clients, config, sessionKey]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void harvesterRef.current?.maybeHarvest(Date.now() / 1000), HARVEST_CHECK_MS);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (running) return;
    const reader = new ViemChainReader(clients.publicClient, config.hashMine);
    let cancelled = false;
    const read = async () => {
      try {
        const state = await reader.roundState(beneficiary ?? '0x0000000000000000000000000000000000000000');
        if (cancelled) return;
        const roundStartsAt = (state.genesis + (Number(state.round) - 1) * state.roundLength) * 1000;
        setChainView({
          round: state.round,
          roundStartsAt,
          roundEndsAt: roundStartsAt + state.roundLength * 1000,
          roundLength: state.roundLength,
          releaseBps: state.releaseBps,
          roundWork: state.roundWork,
          ownWork: 0n,
          challenge: state.challenge,
          difficulty: 0,
          minDifficulty: state.minDifficulty,
          segment: 0n,
          hashRate: 0,
          hitsFound: 0,
          sharesSubmitted: 0,
          batchesSubmitted: 0,
          buffered: 0,
          rewardPool: state.rewardPool,
          pending: state.pending,
          engineErrors: [],
          lastError: null,
          lastTx: null,
        });
      } catch {
        /* keep the last view; the next tick retries */
      }
    };
    void read();
    const timer = setInterval(() => void read(), IDLE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, clients, config.hashMine, beneficiary]);

  useEffect(() => () => controllerRef.current?.stop(), []);

  const claim = useCallback(async () => {
    setStatus('Claiming…');
    try {
      const controller = controllerRef.current;
      const tx = controller
        ? await controller.claim()
        : await new ViemSubmitter(clients, config.hashMine, sessionKey.account).claim(beneficiary!);
      setStatus(`Claimed. Transaction ${tx}`);
    } catch (error) {
      setStatus(`Claim failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [clients, config, sessionKey, beneficiary]);

  const forgetKey = useCallback(() => {
    stop();
    SessionKey.forget(localStorage);
    window.location.reload();
  }, [stop]);

  return {
    sessionKey,
    sessionBalance,
    refreshBalance,
    settings,
    setSettings,
    gpuAvailable,
    gpuName,
    running,
    snapshot: running ? snapshot : (chainView ?? snapshot),
    marks,
    lastShare,
    status,
    start,
    stop,
    claim,
    forgetKey,
  };
}
