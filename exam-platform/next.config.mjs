export default {
  async rewrites() {
    const backend = new URL(process.env.API_ORIGIN || 'http://localhost:3000')
    return [{ source: '/api/v1/:path*', destination: backend.origin + '/api/v1/:path*' }]
  },
  poweredByHeader: false,
  experimental: { cpus: 2 },
}
