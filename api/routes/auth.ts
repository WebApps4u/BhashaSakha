/**
 * This is a user authentication API route demo.
 * Handle user registration, login, token management, etc.
 */
import { Router, type Request, type Response } from 'express'

const router = Router()

/**
 * User Login
 * POST /api/auth/register
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  void req
  res.status(501).json({
    success: false,
    error: 'Not implemented in MVP (Supabase Auth is used on the client).',
  })
})

/**
 * User Login
 * POST /api/auth/login
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  void req
  res.status(501).json({
    success: false,
    error: 'Not implemented in MVP (Supabase Auth is used on the client).',
  })
})

/**
 * User Logout
 * POST /api/auth/logout
 */
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  void req
  res.status(501).json({
    success: false,
    error: 'Not implemented in MVP (Supabase Auth is used on the client).',
  })
})

export default router
