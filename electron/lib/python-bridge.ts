/**
 * Electron ↔ Python ワーカー IPC ブリッジ
 *
 * stdin/stdout JSON lines で通信。ZeroMQ 等の native module 不要。
 * 1行 = 1 JSON メッセージ。リクエスト→レスポンスは順序保証 (1:1)。
 */

import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import path from 'path'
import { existsSync } from 'fs'
import readline from 'readline'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT_MS = 30_000

class PythonBridge {
  private process: ChildProcess | null = null
  private queue: PendingRequest[] = []
  private ready = false

  /** Python ワーカーを起動 */
  async start(): Promise<void> {
    if (this.process) return

    const python3 = ['/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3']
      .find(p => existsSync(p)) ?? 'python3'

    const scriptPath = path.join(app.getAppPath(), 'python_workers', 'api_worker.py')
    if (!existsSync(scriptPath)) {
      console.error(`[PythonBridge] script not found: ${scriptPath}`)
      return
    }

    console.log(`[PythonBridge] starting: ${python3} ${scriptPath}`)

    this.process = spawn(python3, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })

    // stderr → ログ
    this.process.stderr?.on('data', (data: Buffer) => {
      console.error(`[PythonBridge:stderr] ${data.toString().trim()}`)
    })

    // stdout → JSON lines パース
    const rl = readline.createInterface({ input: this.process.stdout! })
    rl.on('line', (line: string) => {
      if (!line.trim()) return
      try {
        const msg = JSON.parse(line)

        // ready シグナル
        if (msg.status === 'ready') {
          this.ready = true
          console.log(`[PythonBridge] ready (pid=${msg.pid})`)
          return
        }

        // shutdown シグナル
        if (msg.status === 'shutdown') {
          console.log(`[PythonBridge] worker shutdown`)
          return
        }

        // 通常レスポンス → キューの先頭に resolve
        const pending = this.queue.shift()
        if (pending) {
          clearTimeout(pending.timer)
          pending.resolve(msg)
        }
      } catch {
        console.error(`[PythonBridge] invalid JSON from worker: ${line.slice(0, 200)}`)
      }
    })

    // プロセス終了
    this.process.on('exit', (code, signal) => {
      console.log(`[PythonBridge] process exited code=${code} signal=${signal}`)
      this.ready = false
      this.process = null
      // 残りの pending を reject
      for (const p of this.queue) {
        clearTimeout(p.timer)
        p.reject(new Error('Python worker exited'))
      }
      this.queue = []
    })

    // ready を待つ (最大5秒)
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (this.ready) { clearInterval(check); resolve() }
      }, 100)
      setTimeout(() => { clearInterval(check); resolve() }, 5000)
    })
  }

  /** リクエストを送信してレスポンスを待つ */
  async send(payload: Record<string, unknown>): Promise<unknown> {
    if (!this.process || !this.ready) {
      throw new Error('Python worker not running')
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex(p => p.resolve === resolve)
        if (idx >= 0) this.queue.splice(idx, 1)
        reject(new Error(`Python request timeout (${REQUEST_TIMEOUT_MS}ms)`))
      }, REQUEST_TIMEOUT_MS)

      this.queue.push({ resolve, reject, timer })
      this.process!.stdin!.write(JSON.stringify(payload) + '\n')
    })
  }

  /** Graceful shutdown */
  async stop(): Promise<void> {
    if (!this.process) return
    try {
      if (this.ready) {
        await this.send({ action: 'shutdown' }).catch(() => {})
      }
    } finally {
      if (this.process && !this.process.killed) {
        this.process.kill('SIGTERM')
        // 3秒待っても終わらなければ SIGKILL
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL')
          }
        }, 3000)
      }
      this.process = null
      this.ready = false
    }
  }

  /** ワーカーが起動中か */
  isReady(): boolean {
    return this.ready
  }
}

export const pythonBridge = new PythonBridge()
