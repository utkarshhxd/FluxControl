#!/usr/bin/env node

const BASE_URL = 'http://localhost:5000';

// Test results tracking
const testResults = {
  algorithms: {},
  clientIdentification: {},
  endpoints: {},
  httpMethods: {},
  bugs: []
};

async function makeRequest(method, endpoint, headers = {}, body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    const data = await response.json().catch(() => ({}));
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      data,
      timestamp: Date.now()
    };
  } catch (error) {
    return { 
      error: error.message, 
      timestamp: Date.now() 
    };
  }
}

async function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resetRateLimit() {
  // Wait for rate limits to reset
  await waitMs(2000);
  
  // Clear any existing rate limits by updating config
  await makeRequest('POST', '/api/config', {}, {
    algorithm: 'fixed-window',
    requestLimit: 1000,
    timeWindow: '1h',
    clientIdType: 'ip',
    isActive: true
  });
  
  await waitMs(500);
}

async function testFixedWindowAlgorithm() {
  console.log('\n=== Testing Fixed Window Algorithm ===');
  
  const algorithm = 'fixed-window';
  const limit = 3;
  const timeWindow = '10s';
  
  try {
    // Configure the algorithm
    const configResponse = await makeRequest('POST', '/api/config', {}, {
      algorithm,
      requestLimit: limit,
      timeWindow,
      clientIdType: 'ip',
      isActive: true
    });
    
    if (configResponse.status !== 200) {
      testResults.bugs.push(`Fixed Window: Config failed with status ${configResponse.status}`);
      return false;
    }
    
    console.log(`Configuration successful for ${algorithm}`);
    
    const results = [];
    
    // Test within limit
    for (let i = 1; i <= limit; i++) {
      const response = await makeRequest('GET', '/api/protected/test', {
        'X-Test-Request': `fixed-window-${i}`
      });
      
      results.push({
        request: i,
        status: response.status,
        remaining: response.headers['x-ratelimit-remaining'],
        allowed: response.status !== 429
      });
      
      console.log(`Request ${i}: Status ${response.status}, Remaining: ${response.headers['x-ratelimit-remaining'] || 'N/A'}`);
      
      if (response.status === 429 && i <= limit) {
        testResults.bugs.push(`Fixed Window: Request ${i} was rate limited but should be allowed (limit: ${limit})`);
      }
      
      await waitMs(100);
    }
    
    // Test exceeding limit
    for (let i = limit + 1; i <= limit + 2; i++) {
      const response = await makeRequest('GET', '/api/protected/test', {
        'X-Test-Request': `fixed-window-exceed-${i}`
      });
      
      results.push({
        request: i,
        status: response.status,
        remaining: response.headers['x-ratelimit-remaining'],
        allowed: response.status !== 429
      });
      
      console.log(`Request ${i}: Status ${response.status}, Remaining: ${response.headers['x-ratelimit-remaining'] || 'N/A'}`);
      
      if (response.status !== 429) {
        testResults.bugs.push(`Fixed Window: Request ${i} should be rate limited but got status ${response.status}`);
      }
      
      await waitMs(100);
    }
    
    testResults.algorithms['fixed-window'] = {
      success: true,
      results,
      correctlyAllowed: results.filter((r, i) => i < limit && r.allowed).length,
      correctlyBlocked: results.filter((r, i) => i >= limit && !r.allowed).length
    };
    
    return true;
    
  } catch (error) {
    testResults.bugs.push(`Fixed Window: Test failed with error - ${error.message}`);
    testResults.algorithms['fixed-window'] = { success: false, error: error.message };
    return false;
  }
}

async function testSlidingWindowAlgorithm() {
  console.log('\n=== Testing Sliding Window Algorithm ===');
  
  await resetRateLimit();
  
  const algorithm = 'sliding-window';
  const limit = 4;
  const timeWindow = '10s';
  
  try {
    // Configure the algorithm
    const configResponse = await makeRequest('POST', '/api/config', {}, {
      algorithm,
      requestLimit: limit,
      timeWindow,
      clientIdType: 'ip',
      isActive: true
    });
    
    if (configResponse.status !== 200) {
      testResults.bugs.push(`Sliding Window: Config failed with status ${configResponse.status}`);
      return false;
    }
    
    console.log(`Configuration successful for ${algorithm}`);
    
    const results = [];
    
    // Test rapid requests within limit
    for (let i = 1; i <= limit; i++) {
      const response = await makeRequest('GET', '/api/protected/test', {
        'X-Test-Request': `sliding-window-${i}`
      });
      
      results.push({
        request: i,
        status: response.status,
        timestamp: Date.now(),
        allowed: response.status !== 429
      });
      
      console.log(`Request ${i}: Status ${response.status}, Time: ${new Date().toISOString()}`);
      
      await waitMs(50); // Small delay
    }
    
    // Test exceeding limit
    const response = await makeRequest('GET', '/api/protected/test', {
      'X-Test-Request': 'sliding-window-exceed'
    });
    
    results.push({
      request: limit + 1,
      status: response.status,
      timestamp: Date.now(),
      allowed: response.status !== 429
    });
    
    console.log(`Request ${limit + 1}: Status ${response.status} (should be 429)`);
    
    if (response.status !== 429) {
      testResults.bugs.push(`Sliding Window: Request ${limit + 1} should be rate limited but got status ${response.status}`);
    }
    
    testResults.algorithms['sliding-window'] = {
      success: true,
      results,
      correctlyAllowed: results.filter((r, i) => i < limit && r.allowed).length,
      correctlyBlocked: results.filter((r, i) => i >= limit && !r.allowed).length
    };
    
    return true;
    
  } catch (error) {
    testResults.bugs.push(`Sliding Window: Test failed with error - ${error.message}`);
    testResults.algorithms['sliding-window'] = { success: false, error: error.message };
    return false;
  }
}

async function testTokenBucketAlgorithm() {
  console.log('\n=== Testing Token Bucket Algorithm ===');
  
  await resetRateLimit();
  
  const algorithm = 'token-bucket';
  const limit = 5;
  const timeWindow = '10s';
  
  try {
    // Configure the algorithm
    const configResponse = await makeRequest('POST', '/api/config', {}, {
      algorithm,
      requestLimit: limit,
      timeWindow,
      clientIdType: 'ip',
      isActive: true
    });
    
    if (configResponse.status !== 200) {
      testResults.bugs.push(`Token Bucket: Config failed with status ${configResponse.status}`);
      return false;
    }
    
    console.log(`Configuration successful for ${algorithm}`);
    
    const results = [];
    
    // Test burst requests
    for (let i = 1; i <= limit + 2; i++) {
      const response = await makeRequest('GET', '/api/protected/test', {
        'X-Test-Request': `token-bucket-${i}`
      });
      
      results.push({
        request: i,
        status: response.status,
        allowed: response.status !== 429
      });
      
      console.log(`Request ${i}: Status ${response.status}`);
      
      // Token bucket should allow burst up to limit, then block
      if (i <= limit && response.status === 429) {
        testResults.bugs.push(`Token Bucket: Request ${i} was rate limited but should be allowed (limit: ${limit})`);
      } else if (i > limit && response.status !== 429) {
        testResults.bugs.push(`Token Bucket: Request ${i} should be rate limited but got status ${response.status}`);
      }
    }
    
    testResults.algorithms['token-bucket'] = {
      success: true,
      results,
      correctlyAllowed: results.filter((r, i) => i < limit && r.allowed).length,
      correctlyBlocked: results.filter((r, i) => i >= limit && !r.allowed).length
    };
    
    return true;
    
  } catch (error) {
    testResults.bugs.push(`Token Bucket: Test failed with error - ${error.message}`);
    testResults.algorithms['token-bucket'] = { success: false, error: error.message };
    return false;
  }
}

async function testClientIdentificationMethods() {
  console.log('\n=== Testing Client Identification Methods ===');
  
  await resetRateLimit();
  
  const identificationMethods = [
    { 
      type: 'ip', 
      testHeaders: [
        {},
        { 'X-Forwarded-For': '192.168.1.100' },
        { 'X-Real-IP': '10.0.0.1' }
      ]
    },
    { 
      type: 'api-key', 
      testHeaders: [
        { 'X-API-Key': 'test-api-key-123' },
        { 'X-API-Key': 'different-api-key-456' },
        { 'Authorization': 'Bearer test-token-789' }
      ]
    },
    { 
      type: 'user-id', 
      testHeaders: [
        { 'X-User-ID': 'user-123' },
        { 'X-User-ID': 'user-456' },
        { 'User-ID': 'user-789' }
      ]
    }
  ];
  
  for (const method of identificationMethods) {
    console.log(`\nTesting ${method.type} identification:`);
    
    try {
      // Configure for this identification method
      await makeRequest('POST', '/api/config', {}, {
        algorithm: 'fixed-window',
        requestLimit: 2,
        timeWindow: '1m',
        clientIdType: method.type,
        isActive: true
      });
      
      await waitMs(500);
      
      const results = [];
      
      for (let headerIndex = 0; headerIndex < method.testHeaders.length; headerIndex++) {
        const headers = method.testHeaders[headerIndex];
        console.log(`  Testing with headers: ${JSON.stringify(headers)}`);
        
        // Make requests with these headers
        for (let i = 1; i <= 3; i++) {
          const response = await makeRequest('GET', '/api/protected/test', {
            ...headers,
            'X-Test-Client': `${method.type}-${headerIndex}-${i}`
          });
          
          results.push({
            headerSet: headerIndex,
            request: i,
            status: response.status,
            headers: headers,
            allowed: response.status !== 429
          });
          
          console.log(`    Request ${i}: Status ${response.status}`);
          
          await waitMs(100);
        }
        
        await waitMs(1000); // Wait between different header sets
      }
      
      testResults.clientIdentification[method.type] = {
        success: true,
        results,
        testsPassed: results.filter(r => 
          (r.request <= 2 && r.allowed) || (r.request > 2 && !r.allowed)
        ).length
      };
      
    } catch (error) {
      testResults.bugs.push(`Client ID ${method.type}: Test failed with error - ${error.message}`);
      testResults.clientIdentification[method.type] = { success: false, error: error.message };
    }
  }
}

async function testHttpMethods() {
  console.log('\n=== Testing HTTP Methods ===');
  
  await resetRateLimit();
  
  // Configure with high limit for HTTP method testing
  await makeRequest('POST', '/api/config', {}, {
    algorithm: 'fixed-window',
    requestLimit: 20,
    timeWindow: '1m',
    clientIdType: 'ip',
    isActive: true
  });
  
  await waitMs(500);
  
  const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  
  for (const method of methods) {
    console.log(`\nTesting ${method} method:`);
    
    try {
      const response = await makeRequest(method, '/api/protected/test', {
        'X-Test-Method': method
      }, method !== 'GET' ? { test: 'data', method } : null);
      
      console.log(`  ${method}: Status ${response.status}, Message: ${response.data?.message || 'N/A'}`);
      
      testResults.httpMethods[method] = {
        status: response.status,
        success: response.status === 200,
        data: response.data
      };
      
      if (response.status !== 200) {
        testResults.bugs.push(`HTTP Method ${method}: Expected status 200, got ${response.status}`);
      }
      
      await waitMs(200);
      
    } catch (error) {
      testResults.bugs.push(`HTTP Method ${method}: Test failed with error - ${error.message}`);
      testResults.httpMethods[method] = { success: false, error: error.message };
    }
  }
}

async function testEndpoints() {
  console.log('\n=== Testing API Endpoints ===');
  
  await resetRateLimit();
  
  const endpoints = [
    { path: '/api/config', method: 'GET', expectedStatus: 200 },
    { path: '/api/stats', method: 'GET', expectedStatus: 200 },
    { path: '/api/active-limits', method: 'GET', expectedStatus: 200 },
    { path: '/api/violations', method: 'GET', expectedStatus: 200 },
    { path: '/api/protected/test', method: 'GET', expectedStatus: 200 },
    { path: '/api/protected/users', method: 'GET', expectedStatus: 200 },
    { path: '/api/protected/orders', method: 'POST', expectedStatus: 200, body: { test: true } },
    { path: '/api/protected/products', method: 'PUT', expectedStatus: 200, body: { id: 1 } }
  ];
  
  for (const endpoint of endpoints) {
    console.log(`\nTesting endpoint: ${endpoint.method} ${endpoint.path}`);
    
    try {
      const response = await makeRequest(
        endpoint.method, 
        endpoint.path, 
        { 'X-Test-Endpoint': endpoint.path },
        endpoint.body
      );
      
      console.log(`  Status: ${response.status}, Expected: ${endpoint.expectedStatus}`);
      
      testResults.endpoints[`${endpoint.method} ${endpoint.path}`] = {
        status: response.status,
        expectedStatus: endpoint.expectedStatus,
        success: response.status === endpoint.expectedStatus,
        data: response.data
      };
      
      if (response.status !== endpoint.expectedStatus) {
        testResults.bugs.push(`Endpoint ${endpoint.method} ${endpoint.path}: Expected status ${endpoint.expectedStatus}, got ${response.status}`);
      }
      
      await waitMs(200);
      
    } catch (error) {
      testResults.bugs.push(`Endpoint ${endpoint.method} ${endpoint.path}: Test failed with error - ${error.message}`);
      testResults.endpoints[`${endpoint.method} ${endpoint.path}`] = { 
        success: false, 
        error: error.message 
      };
    }
  }
}

async function runLoadTest() {
  console.log('\n=== Running Load Test ===');
  
  await resetRateLimit();
  
  // Configure tight rate limit for load testing
  await makeRequest('POST', '/api/config', {}, {
    algorithm: 'fixed-window',
    requestLimit: 10,
    timeWindow: '1m',
    clientIdType: 'ip',
    isActive: true
  });
  
  await waitMs(500);
  
  console.log('Sending 20 concurrent requests...');
  
  const promises = [];
  for (let i = 1; i <= 20; i++) {
    promises.push(
      makeRequest('GET', '/api/protected/test', {
        'X-Load-Test': `request-${i}`
      })
    );
  }
  
  try {
    const responses = await Promise.all(promises);
    
    const allowed = responses.filter(r => r.status === 200).length;
    const rateLimited = responses.filter(r => r.status === 429).length;
    const errors = responses.filter(r => r.error).length;
    
    console.log(`Load test results: ${allowed} allowed, ${rateLimited} rate limited, ${errors} errors`);
    
    testResults.loadTest = {
      totalRequests: 20,
      allowed,
      rateLimited,
      errors,
      success: allowed <= 10 && rateLimited >= 10 // Should allow ~10, block ~10
    };
    
    if (allowed > 12) {
      testResults.bugs.push(`Load Test: Too many requests allowed (${allowed}/20), rate limiting may not be working correctly`);
    }
    
  } catch (error) {
    testResults.bugs.push(`Load Test: Failed with error - ${error.message}`);
    testResults.loadTest = { success: false, error: error.message };
  }
}

function generateTestReport() {
  console.log('\n' + '='.repeat(50));
  console.log('COMPREHENSIVE TEST REPORT');
  console.log('='.repeat(50));
  
  // Algorithm Tests
  console.log('\n📊 RATE LIMITING ALGORITHMS:');
  Object.entries(testResults.algorithms).forEach(([algo, result]) => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${algo}: ${status}`);
    if (result.correctlyAllowed && result.correctlyBlocked) {
      console.log(`    - Correctly allowed: ${result.correctlyAllowed}`);
      console.log(`    - Correctly blocked: ${result.correctlyBlocked}`);
    }
  });
  
  // Client Identification Tests
  console.log('\n🔍 CLIENT IDENTIFICATION:');
  Object.entries(testResults.clientIdentification).forEach(([method, result]) => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${method}: ${status}`);
    if (result.testsPassed) {
      console.log(`    - Tests passed: ${result.testsPassed}`);
    }
  });
  
  // HTTP Methods Tests
  console.log('\n🌐 HTTP METHODS:');
  Object.entries(testResults.httpMethods).forEach(([method, result]) => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${method}: ${status} (Status: ${result.status || 'N/A'})`);
  });
  
  // Endpoints Tests
  console.log('\n🔗 API ENDPOINTS:');
  Object.entries(testResults.endpoints).forEach(([endpoint, result]) => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${endpoint}: ${status} (${result.status}/${result.expectedStatus})`);
  });
  
  // Load Test
  if (testResults.loadTest) {
    console.log('\n⚡ LOAD TEST:');
    const status = testResults.loadTest.success ? '✅ PASS' : '❌ FAIL';
    console.log(`  Concurrent requests: ${status}`);
    if (testResults.loadTest.allowed !== undefined) {
      console.log(`    - Allowed: ${testResults.loadTest.allowed}/${testResults.loadTest.totalRequests}`);
      console.log(`    - Rate limited: ${testResults.loadTest.rateLimited}/${testResults.loadTest.totalRequests}`);
    }
  }
  
  // Bugs and Issues
  console.log('\n🐛 ISSUES FOUND:');
  if (testResults.bugs.length === 0) {
    console.log('  ✅ No issues detected!');
  } else {
    testResults.bugs.forEach((bug, index) => {
      console.log(`  ${index + 1}. ${bug}`);
    });
  }
  
  // Summary
  const totalTests = Object.keys(testResults.algorithms).length + 
                    Object.keys(testResults.clientIdentification).length + 
                    Object.keys(testResults.httpMethods).length + 
                    Object.keys(testResults.endpoints).length +
                    (testResults.loadTest ? 1 : 0);
  
  const passedTests = Object.values(testResults.algorithms).filter(r => r.success).length +
                     Object.values(testResults.clientIdentification).filter(r => r.success).length +
                     Object.values(testResults.httpMethods).filter(r => r.success).length +
                     Object.values(testResults.endpoints).filter(r => r.success).length +
                     (testResults.loadTest?.success ? 1 : 0);
  
  console.log('\n📈 SUMMARY:');
  console.log(`  Total tests: ${totalTests}`);
  console.log(`  Passed: ${passedTests}`);
  console.log(`  Failed: ${totalTests - passedTests}`);
  console.log(`  Issues found: ${testResults.bugs.length}`);
  console.log(`  Success rate: ${Math.round((passedTests / totalTests) * 100)}%`);
  
  console.log('\n' + '='.repeat(50));
}

async function runAllTests() {
  console.log('🚀 Starting Comprehensive Rate Limiter Testing...\n');
  
  try {
    // Test each algorithm
    await testFixedWindowAlgorithm();
    await testSlidingWindowAlgorithm();
    await testTokenBucketAlgorithm();
    
    // Test client identification
    await testClientIdentificationMethods();
    
    // Test HTTP methods
    await testHttpMethods();
    
    // Test endpoints
    await testEndpoints();
    
    // Load test
    await runLoadTest();
    
    // Generate comprehensive report
    generateTestReport();
    
    return testResults;
    
  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
    testResults.bugs.push(`Test Suite: Critical failure - ${error.message}`);
    generateTestReport();
    return testResults;
  }
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().then(results => {
    process.exit(results.bugs.length > 0 ? 1 : 0);
  });
}

export { runAllTests, testResults };