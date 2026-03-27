# UI Review Eval Prompt

Review the login page implementation for UI compliance.

## Context

A login page was implemented with the following structure:

### `src/pages/Login.tsx`
```tsx
import React, { useState } from 'react';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error('Login failed');
      const data = await res.json();
      localStorage.setItem('token', data.token);
      window.location.href = '/dashboard';
    } catch (err) {
      setError('Invalid credentials');
    }
  };

  return (
    <div className="login-container">
      <h1>Login</h1>
      {error && <div className="error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
        <button type="submit">Log In</button>
      </form>
      <a href="/forgot-password">Forgot password?</a>
    </div>
  );
}
```

### Related Files
- `src/styles/login.css` — styling
- `tests/pages/Login.test.tsx` — component tests
- `src/routes.tsx` — route registration

## Instructions

Perform a full UI review following the UI-1 through UI-8 verification checklist. Use deterministic tools (a11y_scan) where applicable. Report findings with file:line references.
