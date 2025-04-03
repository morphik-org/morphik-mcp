// import fetch from 'node-fetch';

// // Mock fetch to avoid actual API calls during tests
// // @ts-ignore
// global.fetch = jest.fn();

// // Import the module with mocked fetch
// import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// import { z } from "zod";

// // Mock data
// const mockDocument = {
//   external_id: "test-doc-123",
//   owner: { userId: "user1" },
//   content_type: "text/plain",
//   filename: "test.txt",
//   metadata: { title: "Test Document" }
// };

// const mockChunks = [
//   {
//     content: "This is chunk 1 content",
//     score: 0.95,
//     document_id: "test-doc-123",
//     chunk_number: 1,
//     metadata: { position: "first" },
//     content_type: "text/plain"
//   },
//   {
//     content: "This is chunk 2 content",
//     score: 0.85,
//     document_id: "test-doc-123",
//     chunk_number: 2,
//     metadata: { position: "second" },
//     content_type: "text/plain"
//   }
// ];

// const mockCompletion = {
//   completion: "This is a test completion based on retrieved chunks",
//   usage: { tokens: 20 },
//   sources: [
//     { document_id: "test-doc-123", chunk_number: 1, score: 0.95 }
//   ]
// };

// // Test function to simulate and verify MCP tool calls
// async function testMorphikMcp() {
//   // Set up fetch mock responses
//   mockFetchResponse({
//     "/ingest/text": { status: 200, json: mockDocument },
//     "/retrieve/chunks": { status: 200, json: mockChunks },
//     "/query": { status: 200, json: mockCompletion },
//     "/documents/test-doc-123": { status: 200, json: mockDocument },
//     "/documents": { status: 200, json: [mockDocument] }
//   });

//   console.log("Running Morphik MCP tests...");

//   // Test ingest-text
//   console.log("\nTesting ingest-text tool:");
//   await testTool("ingest-text", {
//     content: "This is a test document",
//     filename: "test.txt",
//     metadata: { title: "Test Document" },
//     apiKey: "test-api-key"
//   });

//   // Test retrieve-chunks
//   console.log("\nTesting retrieve-chunks tool:");
//   await testTool("retrieve-chunks", {
//     query: "test query",
//     apiKey: "test-api-key"
//   });

//   // Test query
//   console.log("\nTesting query tool:");
//   await testTool("query", {
//     query: "What is in the test document?",
//     apiKey: "test-api-key"
//   });

//   // Test get-document
//   console.log("\nTesting get-document tool:");
//   await testTool("get-document", {
//     documentId: "test-doc-123",
//     apiKey: "test-api-key"
//   });

//   // Test list-documents
//   console.log("\nTesting list-documents tool:");
//   await testTool("list-documents", {
//     apiKey: "test-api-key"
//   });

//   console.log("\nAll tests completed!");
// }

// // Helper function to simulate tool execution
// async function testTool(toolName: string, params: any) {
//   console.log(`Simulating call to ${toolName} with params:`, params);
  
//   try {
//     // Normally we would call the actual MCP tool, but for testing we're just logging
//     console.log(`Tool ${toolName} executed successfully!`);
//     console.log("Mock response would be processed and formatted for user");
//   } catch (error) {
//     console.error(`Error executing ${toolName}:`, error);
//   }
// }

// // Helper to set up fetch mock responses
// function mockFetchResponse(routes: Record<string, { status: number, json: any }>) {
//   // @ts-ignore
//   fetch.mockImplementation((url: string, options: any) => {
//     // Extract the path from the URL
//     const urlPath = url.replace(/^https?:\/\/[^\/]+/i, '');
    
//     // Find the matching route
//     const route = Object.keys(routes).find(r => urlPath.includes(r));
    
//     if (route) {
//       return Promise.resolve({
//         ok: routes[route].status < 400,
//         status: routes[route].status,
//         json: () => Promise.resolve(routes[route].json)
//       });
//     }
    
//     // If no route matches, return a 404
//     return Promise.resolve({
//       ok: false,
//       status: 404,
//       json: () => Promise.resolve({ error: "Not found" })
//     });
//   });
// }

// // Run the tests
// testMorphikMcp().catch(console.error);