import { argon2id, argon2Verify } from 'hash-wasm'

const encoder = new TextEncoder()

export async function digestToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Buffer.from(bytes).toString('base64url')
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: encodedHash })
  } catch {
    return false
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return argon2id({
    password,
    salt,
    iterations: 3,
    parallelism: 4,
    memorySize: 65_536,
    hashLength: 32,
    outputType: 'encoded',
  })
}
