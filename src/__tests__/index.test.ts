// /**
//  * Unit tests for Morphik MCP server
//  * 
//  * This test suite mocks the fetch function to simulate API calls to the Morphik API.
//  */

// // Set up the global fetch mock before importing the modules
// global.fetch = jest.fn();

// // Import internal modules
// import { makeMorphikRequest, processDocumentResponse } from '../index.js';

// // Mock data
// const mockDocument = {
//   external_id: "test-doc-123",
//   owner: { userId: "user1" },
//   content_type: "text/plain",
//   filename: "test.txt",
//   metadata: { title: "Test Document" }
// };

// const mockChunkResults = [
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

// const mockCompletionResponse = {
//   completion: "This is a test completion based on retrieved chunks",
//   usage: { tokens: 20 },
//   sources: [
//     { document_id: "test-doc-123", chunk_number: 1, score: 0.95 }
//   ]
// };

// // Helper function to set up fetch mock responses
// function setupFetchMock(responseData: any, status = 200) {
//   // Reset previous mock implementations
//   (global.fetch as jest.Mock).mockReset();
  
//   // Set up new mock implementation
//   (global.fetch as jest.Mock).mockImplementation(() => {
//     return Promise.resolve({
//       ok: status < 400,
//       status,
//       json: () => Promise.resolve(responseData),
//       text: () => Promise.resolve(JSON.stringify(responseData))
//     });
//   });
// }

// describe('Morphik MCP Server', () => {
//   beforeEach(() => {
//     // Reset fetch mocks before each test
//     (global.fetch as jest.Mock).mockReset();
//   });
  
//   describe('makeMorphikRequest', () => {
//     it('should make a successful GET request', async () => {
//       // Setup mock
//       setupFetchMock(mockDocument);
      
//       // Make request
//       const result = await makeMorphikRequest({
//         url: '/documents/test-doc-123',
//         method: 'GET',
//       });
      
//       // Verify request
//       expect(global.fetch).toHaveBeenCalledWith(
//         expect.stringContaining('/documents/test-doc-123'),
//         expect.objectContaining({
//           method: 'GET',
//           headers: expect.objectContaining({
//             'User-Agent': expect.any(String)
//           })
//         })
//       );
      
//       // Verify response
//       expect(result).toEqual(mockDocument);
//     });
    
//     it('should make a successful POST request with JSON body', async () => {
//       // Setup mock
//       setupFetchMock(mockDocument);
      
//       // Data to send
//       const requestBody = {
//         content: 'Test content',
//         filename: 'test.txt',
//         metadata: { title: 'Test Document' }
//       };
      
//       // Make request
//       const result = await makeMorphikRequest({
//         url: '/ingest/text',
//         method: 'POST',
//         body: requestBody,
//       });
      
//       // Verify request
//       expect(global.fetch).toHaveBeenCalledWith(
//         expect.stringContaining('/ingest/text'),
//         expect.objectContaining({
//           method: 'POST',
//           headers: expect.objectContaining({
//             'Content-Type': 'application/json'
//           }),
//           body: JSON.stringify(requestBody)
//         })
//       );
      
//       // Verify response
//       expect(result).toEqual(mockDocument);
//     });
    
//     it('should handle errors properly', async () => {
//       // Setup mock with error status
//       setupFetchMock({ error: 'Not found' }, 404);
      
//       // Spy on console.error to verify it's called
//       jest.spyOn(console, 'error').mockImplementation(() => {});
      
//       // Make request
//       const result = await makeMorphikRequest({
//         url: '/documents/nonexistent',
//         method: 'GET',
//       });
      
//       // Verify error is logged
//       expect(console.error).toHaveBeenCalled();
      
//       // Verify null is returned
//       expect(result).toBeNull();
      
//       // Restore console.error
//       (console.error as jest.Mock).mockRestore();
//     });
//   });
  
//   describe('Tool Functions', () => {
//     // These tests would check the functions that implement the MCP tools
//     // You would test each MCP tool's handler function separately
    
//     it('should process document response correctly', () => {
//       const formattedDoc = processDocumentResponse(mockDocument);
      
//       expect(formattedDoc).toContain(mockDocument.external_id);
//       expect(formattedDoc).toContain(mockDocument.content_type);
//       expect(formattedDoc).toContain(mockDocument.filename);
//       expect(formattedDoc).toContain('Test Document'); // from metadata
//     });
    
//     // Add more tests for each tool function
//   });
// });