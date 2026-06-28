import type { App as ElectronApp } from 'electron';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LicenseActivationResult, LicenseStatus } from '../../shared/types.js';

type StoredLicenseState = {
  trialStartedAt: string;
  licenseKey?: string;
  expiryDate?: string;
  remainingDays?: number;
  maxDevices?: number;
  activeDevices?: number;
  lastCheckedAt?: string;
  lastValidAt?: string;
  lastStatus?: string;
  blockReason?: string | null;
};

const TRIAL_DAYS = 3;
const DAY_MS = 86_400_000;

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
const cleanUrl = (value: string) => value.replace(/\/+$/, '');

export class LicenseService {
  private statePath: string;
  private machineGuid?: string;

  constructor(private app: ElectronApp) {
    this.statePath = path.join(app.getPath('userData'), 'license-state.json');
  }

  async getStatus(): Promise<LicenseStatus> {
    const state = this.loadState();
    if (state.licenseKey) {
      try {
        return await this.validate();
      } catch {
        const latestState = this.loadState();
        const offlineStatus = this.statusFromState(latestState, 'Could not reach the license server. Connect to the internet and use Validate License.');
        if (offlineStatus.mode === 'licensed' && this.isRecentValidation(latestState.lastValidAt)) {
          return { ...offlineStatus, message: 'License was recently validated. Offline grace access is active.' };
        }
        if (offlineStatus.mode === 'licensed') {
          return { ...offlineStatus, allowed: false, mode: 'blocked', message: 'License validation is required. Connect to the internet and use Validate License.' };
        }
        return offlineStatus;
      }
    }
    return this.statusFromState(state);
  }

  async activate(licenseKey: string): Promise<LicenseActivationResult> {
    const key = licenseKey.trim().toUpperCase();
    if (key.length < 8) throw new Error('Enter a valid license key.');

    const payload = {
      licenseKey: key,
      deviceId: this.getDeviceId(),
      machineGuid: this.getMachineGuid(),
      deviceName: os.hostname(),
      operatingSystem: `${os.type()} ${os.release()}`
    };

    const response = await this.postJson('/api/license/activate', payload);
    if (!response.success) throw new Error(response.error || 'License activation failed.');

    const state = this.loadState();
    this.saveState({
      ...state,
      licenseKey: key,
      expiryDate: response.expiryDate,
      remainingDays: response.remainingDays,
      maxDevices: response.maxDevices,
      activeDevices: response.activeDevices,
      lastCheckedAt: new Date().toISOString(),
      lastValidAt: new Date().toISOString(),
      lastStatus: response.status,
      blockReason: null
    });

    return { ok: true, status: this.statusFromState(this.loadState(), 'License activated successfully.') };
  }

  async validate(): Promise<LicenseStatus> {
    const state = this.loadState();
    if (!state.licenseKey) return this.statusFromState(state);

    const response = await this.postJson('/api/license/check', {
      licenseKey: state.licenseKey,
      deviceId: this.getDeviceId(),
      machineGuid: this.getMachineGuid()
    });

    const valid = Boolean(response.valid);
    this.saveState({
      ...state,
      expiryDate: response.expiryDate ?? state.expiryDate,
      remainingDays: response.remainingDays ?? 0,
      lastCheckedAt: new Date().toISOString(),
      lastValidAt: valid ? new Date().toISOString() : state.lastValidAt,
      lastStatus: response.status,
      blockReason: response.blockReason ?? null
    });

    return this.statusFromState(this.loadState(), valid ? 'License validated successfully.' : undefined);
  }

  private statusFromState(state: StoredLicenseState, overrideMessage?: string): LicenseStatus {
    const now = new Date();
    const trialStarted = new Date(state.trialStartedAt);
    const trialEnds = addDays(trialStarted, TRIAL_DAYS);
    const trialRemainingDays = Math.max(0, Math.ceil((trialEnds.getTime() - now.getTime()) / DAY_MS));
    const trialActive = now.getTime() <= trialEnds.getTime();
    const blockedStatuses = ['blocked', 'suspended', 'expired', 'invalid'];
    const lastStatus = state.lastStatus?.toLowerCase();
    const licenseActive = Boolean(state.licenseKey && lastStatus === 'active' && (state.remainingDays ?? 0) >= 0);
    const licenseBlocked = Boolean(state.licenseKey && lastStatus && blockedStatuses.includes(lastStatus));

    if (licenseActive) {
      return this.decorate({
        allowed: true,
        mode: 'licensed',
        message: overrideMessage ?? `License active. ${state.remainingDays ?? 0} day${state.remainingDays === 1 ? '' : 's'} remaining.`,
        trialStartedAt: state.trialStartedAt,
        trialEndsAt: trialEnds.toISOString(),
        trialRemainingDays,
        licenseKey: state.licenseKey,
        expiryDate: state.expiryDate,
        remainingDays: state.remainingDays,
        maxDevices: state.maxDevices,
        activeDevices: state.activeDevices,
        lastCheckedAt: state.lastCheckedAt,
        blockReason: null
      });
    }

    if (licenseBlocked) {
      return this.decorate({
        allowed: false,
        mode: 'blocked',
        message: overrideMessage ?? `License is ${lastStatus}. Please renew or contact support.`,
        trialStartedAt: state.trialStartedAt,
        trialEndsAt: trialEnds.toISOString(),
        trialRemainingDays,
        licenseKey: state.licenseKey,
        expiryDate: state.expiryDate,
        remainingDays: state.remainingDays,
        lastCheckedAt: state.lastCheckedAt,
        blockReason: state.blockReason
      });
    }

    if (trialActive) {
      return this.decorate({
        allowed: true,
        mode: 'trial',
        message: overrideMessage ?? `Free trial active. ${trialRemainingDays} day${trialRemainingDays === 1 ? '' : 's'} remaining.`,
        trialStartedAt: state.trialStartedAt,
        trialEndsAt: trialEnds.toISOString(),
        trialRemainingDays,
        licenseKey: state.licenseKey,
        expiryDate: state.expiryDate,
        remainingDays: state.remainingDays,
        lastCheckedAt: state.lastCheckedAt,
        blockReason: state.blockReason
      });
    }

    return this.decorate({
      allowed: false,
      mode: state.licenseKey ? 'expired' : 'unlicensed',
      message: overrideMessage ?? 'Your 3-day free trial has ended. Activate a license to continue using JJ Accounting.',
      trialStartedAt: state.trialStartedAt,
      trialEndsAt: trialEnds.toISOString(),
      trialRemainingDays,
      licenseKey: state.licenseKey,
      expiryDate: state.expiryDate,
      remainingDays: state.remainingDays,
      lastCheckedAt: state.lastCheckedAt,
      blockReason: state.blockReason
    });
  }

  private decorate(status: Omit<LicenseStatus, 'licenseServerUrl' | 'deviceId' | 'machineGuid' | 'deviceName' | 'operatingSystem'>): LicenseStatus {
    return {
      ...status,
      licenseServerUrl: this.getServerUrl(),
      deviceId: this.getDeviceId(),
      machineGuid: this.getMachineGuid(),
      deviceName: os.hostname(),
      operatingSystem: `${os.type()} ${os.release()}`
    };
  }

  private loadState(): StoredLicenseState {
    if (!fs.existsSync(this.statePath)) {
      const state = { trialStartedAt: new Date().toISOString() };
      this.saveState(state);
      return state;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as StoredLicenseState;
      if (!parsed.trialStartedAt) parsed.trialStartedAt = new Date().toISOString();
      return parsed;
    } catch {
      const state = { trialStartedAt: new Date().toISOString() };
      this.saveState(state);
      return state;
    }
  }

  private saveState(state: StoredLicenseState) {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }

  private isRecentValidation(lastValidAt?: string) {
    if (!lastValidAt) return false;
    return Date.now() - new Date(lastValidAt).getTime() <= TRIAL_DAYS * DAY_MS;
  }

  private async postJson(endpoint: string, body: Record<string, unknown>) {
    const response = await fetch(`${this.getServerUrl()}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `License server returned ${response.status}.`);
    return data;
  }

  private getServerUrl() {
    return cleanUrl(process.env.LEDGERLY_LICENSE_API_URL || process.env.VITE_LICENSE_API_URL || 'https://jj-accounting.vercel.app');
  }

  private getDeviceId() {
    const source = [this.getMachineGuid(), os.hostname(), os.arch(), os.platform()].filter(Boolean).join('|');
    return crypto.createHash('sha256').update(source).digest('hex');
  }

  private getMachineGuid() {
    if (this.machineGuid !== undefined) return this.machineGuid;
    if (process.platform !== 'win32') {
      this.machineGuid = os.hostname();
      return this.machineGuid;
    }
    try {
      const output = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
      this.machineGuid = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/)?.[1]?.trim() || os.hostname();
    } catch {
      this.machineGuid = os.hostname();
    }
    return this.machineGuid;
  }
}
