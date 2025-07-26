import path from "path";
import os from "os";
import { MorphikConfig } from "./types.js";

// Path normalization utilities
export function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

export function normalizePath(p: string): string {
  return path.normalize(p);
}

// Parse command line arguments and return configuration
export function parseConfig(): MorphikConfig {
  const args = process.argv.slice(2);
  let morphikApiBase = "http://localhost:8000"; // Default Base URL for Morphik API
  let authToken = ""; // Bearer token for authentication
  let uriProvided = false;
  let allowedDirectories: string[] = [];

  // Parse URI format or URI argument
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--uri=')) {
      uriProvided = true;
      const uriValue = arg.substring(6);
      
      // Handle local case
      if (uriValue === 'local' || uriValue === '') {
        // Use default localhost URL
        morphikApiBase = "http://localhost:8000";
      }
      // Check if it's a morphik URI format: morphik://<owner_id>:<token>@<host>
      else if (uriValue.startsWith('morphik://')) {
        try {
          // Parse the morphik URI format
          const uriWithoutProtocol = uriValue.replace('morphik://', '');
          const [authPart, hostPart] = uriWithoutProtocol.split('@');
          
          if (authPart && hostPart) {
            // Extract token from auth part (format: owner_id:token)
            const [, token] = authPart.split(':');
            
            if (token) {
              authToken = token;
              // Always use HTTPS for Morphik API with authentication
              morphikApiBase = `https://${hostPart}`;
            }
          }
        } catch (error) {
          console.error("Error parsing morphik URI:", error);
          // Fall back to using the URI value directly
          morphikApiBase = uriValue;
        }
      } else {
        // Not a morphik URI, use as is
        morphikApiBase = uriValue;
      }
    }
  }

  // If no URI was provided, use localhost
  if (!uriProvided) {
    morphikApiBase = "http://localhost:8000";
  }

  // Find allowed directories argument
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--allowed-dir=')) {
      let dirValue = arg.substring(13); // Get value after --allowed-dir=
      if (dirValue) {
        // Split by comma
        allowedDirectories = dirValue.split(',').map(dir => {
          // Trim whitespace and potential leading '='
          let cleanDir = dir.trim();
          if (cleanDir.startsWith('=')) {
            cleanDir = cleanDir.substring(1);
          }
          // Expand home dir and normalize
          return normalizePath(expandHome(cleanDir));
        });
      }
    }
  }

  // If no allowed directories were specified, use home directory as default
  if (allowedDirectories.length === 0) {
    allowedDirectories = [normalizePath(os.homedir())];
    console.error('No allowed directories specified, defaulting to home directory');
  }

  const config: MorphikConfig = {
    apiBase: morphikApiBase,
    authToken,
    userAgent: "morphik-mcp/1.0",
    allowedDirectories
  };

  // Log connection info with clear indication of mode
  if (config.apiBase === "http://localhost:8000") {
    console.error(`Connecting to Morphik API in local mode: ${config.apiBase}`);
  } else {
    console.error(`Connecting to Morphik API at: ${config.apiBase}`);
  }

  // Log authentication status
  if (config.authToken) {
    console.error('Authentication: Using bearer token from URI');
  } else {
    console.error('Authentication: None (development mode)');
  }

  console.error('Allowed directories for file operations:', config.allowedDirectories);

  return config;
}