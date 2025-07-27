import fetch from "node-fetch";
import FormData from "form-data";
import { MorphikConfig } from "./types.js";

// Helper function for making Morphik API requests
export async function makeMorphikRequest<T>({
  url,
  method = "GET",
  body = undefined,
  isMultipart = false,
  config,
}: {
  url: string;
  method?: string;
  body?: any;
  isMultipart?: boolean;
  config: MorphikConfig;
}): Promise<T | null> {
  const fullUrl = url.startsWith("http") ? url : `${config.apiBase}${url}`;
  
  // Prepare headers based on content type and authorization
  const headers: Record<string, string> = {
    "User-Agent": config.userAgent,
  };
  
  // Add Authorization header if we have a token
  if (config.authToken) {
    headers["Authorization"] = `Bearer ${config.authToken}`;
  }
  
  if (!isMultipart && body !== undefined) {
    headers["Content-Type"] = "application/json";
  } else if (isMultipart && body instanceof FormData) {
    // When using FormData, get the generated headers with boundaries
    Object.assign(headers, body.getHeaders());
  }
  
  try {
    // Prepare request options - using any to bypass type checking issues
    const requestOptions: any = {
      method,
      headers,
    };
    
    // Add body if provided
    if (body !== undefined) {
      if (isMultipart) {
        // For multipart requests, body should be FormData
        requestOptions.body = body;
      } else {
        // For JSON requests, stringify the body
        requestOptions.body = JSON.stringify(body);
      }
    }
    
    // Make the request
    const response = await fetch(fullUrl, requestOptions);
    
    // Check for HTTP errors
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    
    // Parse and return JSON response
    return await response.json() as T;
  } catch (error) {
    console.error("Error making Morphik request:", error);
    return null;
  }
}

// Helper function for making direct fetch requests with FormData
export async function makeDirectRequest<T>(url: string, formData: FormData, config: MorphikConfig): Promise<T> {
  const fullUrl = url.startsWith("http") ? url : `${config.apiBase}${url}`;
  
  // Set up headers from FormData with proper typing
  const headers: Record<string, string> = {
    "User-Agent": config.userAgent,
    // Spread the FormData headers
    ...(formData.getHeaders() as Record<string, string>)
  };
  
  // Add Authorization header if we have a token
  if (config.authToken) {
    headers["Authorization"] = `Bearer ${config.authToken}`;
  }
  
  // Make the request with bypass type checking via any
  const requestOptions: any = {
    method: "POST",
    headers,
    body: formData
  };
  
  const response = await fetch(fullUrl, requestOptions);
  
  // Check for HTTP errors
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
  }
  
  // Parse and return JSON response
  return await response.json() as T;
}