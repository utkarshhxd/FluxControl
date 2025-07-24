#!/usr/bin/env node

const BASE_URL = 'http://localhost:5000';

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
      data
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function testAlgorithm(algorithm, limit = 5, timeWindow = '1m') {
  console.log(`\n=== Testing ${algorithm} Algorithm ===`);
  
  // Configure the algorithm
  const configResponse = await makeRequest('POST', '/api/config', {}, {
    algorithm,
    requestLimit: limit,
    timeWindow,
    clientIdType: 'ip',
    isActive: true
  });
  
  console.log(`Configuration: ${JSON.stringify(configResponse.data)}`);
  
  // Test requests
  for (let i = 1; i <= limit + 3; i++) {
    const response = await makeRequest('GET', '/api/protected/test', {
      'X-Test-Request': `${algorithm}-${i}`
    });
    
    console.log(`Request ${i}: Status ${response.status}, Remaining: ${response.headers['x-ratelimit-remaining'] || 'N/A'}`);
    
    if (response.status === 429) {
      console.log(`  Rate limited! Retry-After: ${response.headers['retry-after'] || 'N/A'}`);
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function testClientIdentification() {
  console.log(`\n=== Testing Client Identification Methods ===`);
  
  const identificationMethods = [
    { type: 'ip', testHeader: {} },
    { type: 'api-key', testHeader: { 'X-API-Key': 'test-api-key-123' } },
    { type: 'user-id', testHeader: { 'X-User-ID': 'user-456' } }
  ];
  
  for (const method of identificationMethods) {
    console.log(`\nTesting ${method.type} identification:`);
    
    // Configure for this identification method
    await makeRequest('POST', '/api/config', {}, {
      algorithm: 'fixed-window',
      requestLimit: 3,
      timeWindow: '1m',
      clientIdType: method.type,
      isActive: true
    });
    
    // Make test requests
    for (let i = 1; i <= 5; i++) {
      const response = await makeRequest('GET', '/api/protected/test', method.testHeader);
      console.log(`  Request ${i}: Status ${response.status}, Remaining: ${response.headers['x-ratelimit-remaining'] || 'N/A'}`);
      
      if (response.status === 429) {
        console.log(`    Rate limited with ${method.type} identification`);
        break;
      }
    }
  }
}

async function testHttpMethods() {
  console.log(`\n=== Testing HTTP Methods ===`);
  
  // Configure rate limiter
  await makeRequest('POST', '/api/config', {}, {
    algorithm: 'fixed-window',
    requestLimit: 10,
    timeWindow: '1m',
    clientIdType: 'ip',
    isActive: true
  });
  
  const methods = ['GET', 'POST', 'PUT', 'DELETE'];
  
  for (const method of methods) {
    console.log(`\nTesting ${method} method:`);
    
    const response = await makeRequest(method, '/api/protected/test', {
      'X-Test-Method': method
    }, method !== 'GET' ? { test: 'data' } : null);
    
    console.log(`  ${method}: Status ${response.status}, Message: ${response.data?.message || 'N/A'}`);
    console.log(`  Rate limit remaining: ${response.headers['x-ratelimit-remaining'] || 'N/A'}`);
  }
}

async function testEndpoints() {
  console.log(`\n=== Testing Different Endpoints ===`);
  
  const endpoints = [
    '/api/protected/test',
    '/api/protected/users',
    '/api/protected/orders',
    '/api/protected/products'
  ];
  
  for (const endpoint of endpoints) {
    console.log(`\nTesting endpoint: ${endpoint}`);
    
    const response = await makeRequest('GET', endpoint, {
      'X-Test-Endpoint': endpoint
    });
    
    console.log(`  Status: ${response.status}, Message: ${response.data?.message || response.data?.endpoint || 'N/A'}`);
  }
}

async function runAllTests() {
  console.log('Starting comprehensive rate limiter tests...\n');
  
  try {
    // Test all algorithms
    await testAlgorithm('fixed-window', 5, '1m');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait between tests
    
    await testAlgorithm('sliding-window', 4, '30s');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await testAlgorithm('token-bucket', 6, '1m');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test client identification
    await testClientIdentification();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test HTTP methods
    await testHttpMethods();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test different endpoints
    await testEndpoints();
    
    console.log('\n=== Test Summary ===');
    console.log('All tests completed successfully!');
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

runAllTests();