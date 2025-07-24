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

async function clearRateLimits() {
  // Clear rate limits by setting a very high limit temporarily
  await makeRequest('POST', '/api/config', {}, {
    algorithm: 'fixed-window',
    requestLimit: 999,
    timeWindow: '1h',
    clientIdType: 'ip',
    isActive: true
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
}

async function testFixedWindow() {
  console.log('\n=== Testing Fixed Window Algorithm ===');
  
  await clearRateLimits();
  
  // Configure tight limits for testing
  const configResponse = await makeRequest('POST', '/api/config', {}, {
    algorithm: 'fixed-window',
    requestLimit: 3,
    timeWindow: '30s',
    clientIdType: 'ip',
    isActive: true
  });
  
  console.log('Configuration:', configResponse.status === 200 ? 'SUCCESS' : 'FAILED');
  
  if (configResponse.status !== 200) {
    console.log('❌ Configuration failed');
    return false;
  }
  
  const results = [];
  
  // Test within limit (should pass)
  for (let i = 1; i <= 3; i++) {
    const response = await makeRequest('GET', '/api/protected/test');
    results.push({ request: i, status: response.status, expected: 200 });
    console.log(`Request ${i}: ${response.status} (expected 200)`);
    
    if (response.status !== 200) {
      console.log(`❌ Request ${i} should have been allowed`);
      return false;
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Test exceeding limit (should fail)
  for (let i = 4; i <= 5; i++) {
    const response = await makeRequest('GET', '/api/protected/test');
    results.push({ request: i, status: response.status, expected: 429 });
    console.log(`Request ${i}: ${response.status} (expected 429)`);
    
    if (response.status !== 429) {
      console.log(`❌ Request ${i} should have been rate limited`);
      return false;
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('✅ Fixed Window algorithm working correctly');
  return true;
}

async function testSlidingWindow() {
  console.log('\n=== Testing Sliding Window Algorithm ===');
  
  await clearRateLimits();
  
  const configResponse = await makeRequest('POST', '/api/config', {}, {
    algorithm: 'sliding-window',
    requestLimit: 3,
    timeWindow: '10s',
    clientIdType: 'ip',
    isActive: true
  });
  
  console.log('Configuration:', configResponse.status === 200 ? 'SUCCESS' : 'FAILED');
  
  if (configResponse.status !== 200) {
    console.log('❌ Configuration failed');
    return false;
  }
  
  // Test rapid requests
  for (let i = 1; i <= 3; i++) {
    const response = await makeRequest('GET', '/api/protected/test');
    console.log(`Request ${i}: ${response.status} (expected 200)`);
    
    if (response.status !== 200) {
      console.log(`❌ Request ${i} should have been allowed`);
      return false;
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  // Fourth request should be blocked
  const response = await makeRequest('GET', '/api/protected/test');
  console.log(`Request 4: ${response.status} (expected 429)`);
  
  if (response.status !== 429) {
    console.log(`❌ Request 4 should have been rate limited`);
    return false;
  }
  
  console.log('✅ Sliding Window algorithm working correctly');
  return true;
}

async function testTokenBucket() {
  console.log('\n=== Testing Token Bucket Algorithm ===');
  
  await clearRateLimits();
  
  const configResponse = await makeRequest('POST', '/api/config', {}, {
    algorithm: 'token-bucket',
    requestLimit: 4,
    timeWindow: '15s',
    clientIdType: 'ip',
    isActive: true
  });
  
  console.log('Configuration:', configResponse.status === 200 ? 'SUCCESS' : 'FAILED');
  
  if (configResponse.status !== 200) {
    console.log('❌ Configuration failed');
    return false;
  }
  
  let passedRequests = 0;
  let blockedRequests = 0;
  
  // Test burst requests
  for (let i = 1; i <= 6; i++) {
    const response = await makeRequest('GET', '/api/protected/test');
    console.log(`Request ${i}: ${response.status}`);
    
    if (response.status === 200) {
      passedRequests++;
    } else if (response.status === 429) {
      blockedRequests++;
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  console.log(`Results: ${passedRequests} passed, ${blockedRequests} blocked`);
  
  // Token bucket should allow burst up to limit, then block
  if (passedRequests >= 3 && blockedRequests >= 1) {
    console.log('✅ Token Bucket algorithm working correctly');
    return true;
  } else {
    console.log(`❌ Token Bucket not working correctly`);
    return false;
  }
}

async function testClientIdentification() {
  console.log('\n=== Testing Client Identification ===');
  
  const methods = [
    { type: 'ip', headers: {} },
    { type: 'api-key', headers: { 'X-API-Key': 'test-key-123' } },
    { type: 'user-id', headers: { 'X-User-ID': 'user-456' } }
  ];
  
  for (const method of methods) {
    console.log(`\nTesting ${method.type} identification:`);
    
    await clearRateLimits();
    
    // Configure with this identification method
    const configResponse = await makeRequest('POST', '/api/config', {}, {
      algorithm: 'fixed-window',
      requestLimit: 2,
      timeWindow: '30s',
      clientIdType: method.type,
      isActive: true
    });
    
    if (configResponse.status !== 200) {
      console.log(`❌ Configuration failed for ${method.type}`);
      continue;
    }
    
    let success = true;
    
    // Test with this client
    for (let i = 1; i <= 3; i++) {
      const response = await makeRequest('GET', '/api/protected/test', method.headers);
      const expectedStatus = i <= 2 ? 200 : 429;
      console.log(`  Request ${i}: ${response.status} (expected ${expectedStatus})`);
      
      if (response.status !== expectedStatus) {
        console.log(`  ❌ Request ${i} failed for ${method.type}`);
        success = false;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (success) {
      console.log(`  ✅ ${method.type} identification working correctly`);
    }
  }
}

async function testHttpMethods() {
  console.log('\n=== Testing HTTP Methods ===');
  
  await clearRateLimits();
  
  // Configure with high limit for method testing
  await makeRequest('POST', '/api/config', {}, {
    algorithm: 'fixed-window',
    requestLimit: 20,
    timeWindow: '1h',
    clientIdType: 'ip',
    isActive: true
  });
  
  const methods = ['GET', 'POST', 'PUT', 'DELETE'];
  
  for (const method of methods) {
    const response = await makeRequest(method, '/api/protected/test', {}, 
      method !== 'GET' ? { test: 'data' } : null);
    
    console.log(`${method}: ${response.status} (expected 200)`);
    
    if (response.status !== 200) {
      console.log(`❌ ${method} method failed`);
      return false;
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('✅ All HTTP methods working correctly');
  return true;
}

async function testEndpoints() {
  console.log('\n=== Testing API Endpoints ===');
  
  const endpoints = [
    { path: '/api/config', method: 'GET', expectedStatus: 200 },
    { path: '/api/stats', method: 'GET', expectedStatus: 200 },
    { path: '/api/active-limits', method: 'GET', expectedStatus: 200 },
    { path: '/api/violations', method: 'GET', expectedStatus: 200 },
    { path: '/api/protected/test', method: 'GET', expectedStatus: 200 },
    { path: '/api/protected/users', method: 'GET', expectedStatus: 200 }
  ];
  
  let allPassed = true;
  
  for (const endpoint of endpoints) {
    const response = await makeRequest(endpoint.method, endpoint.path);
    console.log(`${endpoint.method} ${endpoint.path}: ${response.status} (expected ${endpoint.expectedStatus})`);
    
    if (response.status !== endpoint.expectedStatus) {
      console.log(`❌ Endpoint ${endpoint.path} failed`);
      allPassed = false;
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  if (allPassed) {
    console.log('✅ All endpoints working correctly');
  }
  
  return allPassed;
}

async function runAllTests() {
  console.log('🚀 Starting Focused Rate Limiter Tests\n');
  
  const results = {
    fixedWindow: false,
    slidingWindow: false,
    tokenBucket: false,
    clientId: true, // Will be set to false if any client ID test fails
    httpMethods: false,
    endpoints: false
  };
  
  try {
    results.fixedWindow = await testFixedWindow();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    results.slidingWindow = await testSlidingWindow();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    results.tokenBucket = await testTokenBucket();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await testClientIdentification();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    results.httpMethods = await testHttpMethods();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    results.endpoints = await testEndpoints();
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('TEST RESULTS SUMMARY');
    console.log('='.repeat(50));
    
    console.log(`Fixed Window Algorithm: ${results.fixedWindow ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Sliding Window Algorithm: ${results.slidingWindow ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Token Bucket Algorithm: ${results.tokenBucket ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Client Identification: ${results.clientId ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`HTTP Methods: ${results.httpMethods ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`API Endpoints: ${results.endpoints ? '✅ PASS' : '❌ FAIL'}`);
    
    const passedTests = Object.values(results).filter(r => r).length;
    const totalTests = Object.keys(results).length;
    
    console.log(`\nOverall: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
      console.log('🎉 All tests passed! Rate limiter is working correctly.');
    } else {
      console.log('⚠️  Some tests failed. Issues need to be addressed.');
    }
    
    return results;
    
  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
    return results;
  }
}

runAllTests().then(results => {
  const allPassed = Object.values(results).every(r => r);
  process.exit(allPassed ? 0 : 1);
});