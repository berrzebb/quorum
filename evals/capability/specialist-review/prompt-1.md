# Specialist Review Eval Prompt

Review auth middleware changes for security domain.

## Context

The following files were changed in the auth middleware implementation:

### `src/middleware/auth.ts` (new file)
```typescript
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    (req as any).user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

### `src/auth/login.ts` (new file)
```typescript
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('User not found');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error('Invalid password');

  const token = jwt.sign({ userId: user.id, email }, process.env.JWT_SECRET!, {
    expiresIn: '15m'
  });
  return { token, user: { id: user.id, email: user.email } };
}
```

## Instructions

Perform a security domain specialist review of these auth middleware changes. Follow the specialist review protocol: use deterministic tools first, then apply domain-specific LLM analysis.
