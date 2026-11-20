import { Router } from 'express';
import healthRoutes from './health.routes.js';

const router = Router();

// Unversioned, like every SECEP service (NFR-OPS-002). Public API routers mount under /api/v1 (SRS §6.5).
router.use('/health', healthRoutes);

export default router;
