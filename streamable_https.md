# Morphik MCP Server - HTTP/HTTPS Setup

## Quick Start

```bash
# Build the project
npm run build

# Run with default localhost:8000 (no authentication)
./start_mcp

# Run with custom API endpoint (must include protocol)
./start_mcp --uri=https://my-api.morphik.ai
```

## Authentication

When using the `morphik://` URI format, the server extracts the token and adds it as Bearer authentication to all API requests.

### Using the Morphik URI Format

For authenticated connections, use the special `morphik://` URI format:

```bash
./start_mcp --uri=morphik://owner_id:your-token-here@api.morphik.ai
```

This format:
- Automatically uses HTTPS
- Extracts the token and sends it as `Authorization: Bearer your-token-here`
- The `owner_id` is required in the URI format but not used for authentication

### Examples

```bash
# Local development (no auth)
./start_mcp

# Custom endpoint without auth (must include protocol)
./start_mcp --uri=http://dev.morphik.ai

# Production with authentication using morphik:// format
./start_mcp --uri=morphik://myorg:sk-abc123xyz@api.morphik.ai
```

## How It Works

The server runs on port 8976 by default and provides:
- `GET /health` - Health check endpoint
- `POST /mcp` - MCP protocol endpoint (stateless)

Each request includes:
- `Authorization: Bearer <token>` header (only when using morphik:// URI format)
- `User-Agent: morphik-mcp/1.0` header

## Environment Variables

You can also use environment variables:

```bash
export API_URI=https://api.morphik.ai
export PORT=3000
npm start
```

Note: The `API_URI` environment variable doesn't support the `morphik://` format - use command line arguments for authenticated connections.