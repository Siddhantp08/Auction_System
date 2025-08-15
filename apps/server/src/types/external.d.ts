// Ambient declarations to satisfy TypeScript for optional, runtime-only dependencies.
// These modules may not be installed in all deployments; files referencing them
// should guard runtime usage behind environment checks.

declare module '@sendgrid/mail' {
  const sg: any
  export default sg
}

declare module '@upstash/redis' {
  export class Redis {
    constructor(config: { url: string; token: string })
    hgetall<T = Record<string, string>>(key: string): Promise<T | null>
    hset(key: string, value: Record<string, any>): Promise<any>
    get<T = string>(key: string): Promise<T | null>
    set(key: string, value: string, opts?: { ex?: number }): Promise<any>
    sadd?(key: string, ...members: string[]): Promise<any>
    smembers?(key: string): Promise<string[]>
    del?(key: string): Promise<any>
  }
}

declare module 'sequelize' {
  export const DataTypes: any
  export class Sequelize {
    constructor(database: string, username: string, password: string, opts: any)
    define(name: string, schema: any, options?: any): any
    sync(): Promise<void>
  }
}

declare module 'twilio' {
  const twilio: any
  export default twilio
}
