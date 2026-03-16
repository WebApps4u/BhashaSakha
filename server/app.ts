/**
 * This is a API server
 */

import './fetchPolyfill.js'

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import crypto from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import authRoutes from './routes/auth.js'
import translateRoutes from './routes/translate.js'
import configRoutes from './routes/config.js'
import geminiRoutes from './routes/gemini.js'
import adminRoutes from './routes/admin.js'
import subscriptionRoutes from './routes/subscriptions.js'
import modelRequestRoutes from './routes/modelRequest.js'
import modelsRoutes from './routes/models.js'
import ttsRoutes from './routes/tts.js'
import detectRoutes from './routes/detect.js'

// load env
dotenv.config()

const app: express.Application = express()

const corsOrigins = (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean)
app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : '*',
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-bootstrap-token', 'x-request-id'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }),
)

app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = req.header('x-request-id') ?? crypto.randomUUID()
  res.setHeader('x-request-id', requestId)
  ;(res.locals as any).requestId = requestId

  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-frame-options', 'DENY')
  next()
})
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api/translate', translateRoutes)
app.use('/api/config', configRoutes)
app.use('/api/gemini', geminiRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/subscriptions', subscriptionRoutes)
app.use('/api/model-request', modelRequestRoutes)
app.use('/api/models', modelsRoutes)
app.use('/api/tts', ttsRoutes)
app.use('/api/detect', detectRoutes)

const tryServeFrontend = () => {
  const enabled = (process.env.SERVE_FRONTEND ?? '').toLowerCase().trim()
  if (!(enabled === 'true' || enabled === '1' || enabled === 'yes' || process.env.NODE_ENV === 'production')) return

  const here = path.dirname(fileURLToPath(import.meta.url))
  const distDir = path.resolve(here, '../../dist')
  const indexPath = path.join(distDir, 'index.html')

  app.use(express.static(distDir, {
    index: false,
    maxAge: '1y',
    immutable: true,
  }))

  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) return next()
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    res.sendFile(indexPath)
  })
}

tryServeFrontend()

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  void req
  void next
  try {
    const requestId = (res.locals as any).requestId
    console.error('api_error', { requestId, message: error.message })
  } catch {
    console.error('api_error', error.message)
  }
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
