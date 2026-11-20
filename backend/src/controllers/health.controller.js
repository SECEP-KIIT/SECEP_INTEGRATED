import { getStatus } from '../services/health.service.js';

export function getHealth(req, res) {
  res.json(getStatus());
}
