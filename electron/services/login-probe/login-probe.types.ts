/**
 * Login Probe - 型定義
 *
 * Instagram半自動ログインフローの型を集約。
 * 危険画面検知 / phase tracking。
 */

// ============================================================
// Login phase（状態機械）
// ============================================================
export type LoginPhase =
  | 'idle'                    // 開始前
  | 'navigating'              // ログイン画面ロード中
  | 'entering_credentials'    // ユーザー名 / パスワード入力中
  | 'awaiting_2fa'            // 2FA画面到達
  | 'entering_2fa'            // TOTPコード入力中
  | 'challenge_detected'      // 危険画面検知 → 停止
  | 'logged_in'               // 成功
  | 'failed';                 // 失敗（challenge以外）

// ============================================================
// 検知シグナル
// ============================================================
export type ChallengeSignalLayer = 'url' | 'dom' | 'network';

export type ChallengeSignal = {
  layer: ChallengeSignalLayer;
  value: string;
  phase: LoginPhase;
  matchedAt: string;
};

// ============================================================
// Probe options（呼び出し時のinput）
// ============================================================
export type LoginProbeOptions = {
  accountId: number;
  username: string;
  password: string;
  totpSecret?: string;
  skipIfSessionAlive?: boolean;
};

// ============================================================
// Probe result
// ============================================================
export type LoginProbeResult =
  | {
      ok: true;
      accountId: number;
      sessionAlreadyAlive: boolean;
    }
  | {
      ok: false;
      accountId: number;
      phase: LoginPhase;
      signal?: ChallengeSignal;
      error?: string;
    };

// ============================================================
// Bulk実行のconfig
// ============================================================
export type BulkLoginConfig = {
  concurrency?: number;
  jitterMs?: number;
};

// ============================================================
// Renderer向け通知ペイロード
// ============================================================
export type ChallengeNotification = {
  accountId: number;
  username?: string;
  phase: LoginPhase;
  signal: ChallengeSignal;
};
