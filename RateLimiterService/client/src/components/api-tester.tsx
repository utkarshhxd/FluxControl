import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Send, Play, Square, RotateCcw, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TestResult {
  status: number;
  timestamp: string;
  responseTime: number;
  rateLimitHeaders?: {
    limit?: string;
    remaining?: string;
    reset?: string;
    retryAfter?: string;
  };
  response?: any;
}

export function APITester() {
  const { toast } = useToast();
  const [method, setMethod] = useState('GET');
  const [endpoint, setEndpoint] = useState('/api/protected/test');
  const [headers, setHeaders] = useState('{"X-API-Key": "test-key"}');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Burst testing state
  const [burstCount, setBurstCount] = useState(30);
  const [burstDelay, setBurstDelay] = useState(100);
  const [isBurstTesting, setIsBurstTesting] = useState(false);
  const [burstProgress, setBurstProgress] = useState(0);
  const [burstResults, setBurstResults] = useState<TestResult[]>([]);
  const abortController = useRef<AbortController | null>(null);

  const sendSingleRequest = async (): Promise<TestResult> => {
    const startTime = performance.now();
    
    let parsedHeaders = {};
    try {
      parsedHeaders = headers ? JSON.parse(headers) : {};
    } catch {
      throw new Error('Invalid headers JSON');
    }

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...parsedHeaders,
      },
      credentials: 'include',
      signal: abortController.current?.signal,
    };

    const response = await fetch(endpoint, options);
    const responseTime = performance.now() - startTime;
    const responseData = await response.json().catch(() => ({}));

    return {
      status: response.status,
      timestamp: new Date().toISOString(),
      responseTime: Math.round(responseTime),
      rateLimitHeaders: {
        limit: response.headers.get('X-RateLimit-Limit') || undefined,
        remaining: response.headers.get('X-RateLimit-Remaining') || undefined,
        reset: response.headers.get('X-RateLimit-Reset') || undefined,
        retryAfter: response.headers.get('Retry-After') || undefined,
      },
      response: responseData,
    };
  };

  const sendRequest = async () => {
    setIsLoading(true);
    try {
      const result = await sendSingleRequest();
      setResponse(JSON.stringify(result, null, 2));
      
      toast({
        title: result.status < 400 ? "Request Successful" : "Request Failed",
        description: `Status: ${result.status} | Response time: ${result.responseTime}ms`,
        variant: result.status < 400 ? "default" : "destructive",
      });
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      
      const errorMessage = error.message || 'Request failed';
      setResponse(`Error: ${errorMessage}`);
      toast({
        title: "Request Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const startBurstTest = async () => {
    setIsBurstTesting(true);
    setBurstProgress(0);
    setBurstResults([]);
    abortController.current = new AbortController();

    try {
      const results: TestResult[] = [];
      
      for (let i = 0; i < burstCount; i++) {
        if (abortController.current?.signal.aborted) break;
        
        try {
          const result = await sendSingleRequest();
          results.push(result);
          setBurstResults([...results]);
          setBurstProgress(((i + 1) / burstCount) * 100);
          
          if (i < burstCount - 1 && burstDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, burstDelay));
          }
        } catch (error: any) {
          if (error.name === 'AbortError') break;
          
          results.push({
            status: 0,
            timestamp: new Date().toISOString(),
            responseTime: 0,
            response: { error: error.message },
          });
          setBurstResults([...results]);
          setBurstProgress(((i + 1) / burstCount) * 100);
        }
      }

      const successCount = results.filter(r => r.status >= 200 && r.status < 300).length;
      const rateLimitedCount = results.filter(r => r.status === 429).length;
      
      toast({
        title: "Burst Test Completed",
        description: `${successCount} successful, ${rateLimitedCount} rate limited out of ${results.length} requests`,
      });
    } catch (error) {
      toast({
        title: "Burst Test Failed",
        description: "An error occurred during burst testing",
        variant: "destructive",
      });
    } finally {
      setIsBurstTesting(false);
      setBurstProgress(0);
    }
  };

  const stopBurstTest = () => {
    abortController.current?.abort();
    setIsBurstTesting(false);
    setBurstProgress(0);
  };

  const clearResults = () => {
    setBurstResults([]);
    setResponse('');
  };

  const exportResults = () => {
    const data = {
      testConfig: {
        endpoint,
        method,
        headers: JSON.parse(headers || '{}'),
        burstCount,
        burstDelay,
      },
      results: burstResults,
      summary: {
        total: burstResults.length,
        successful: burstResults.filter(r => r.status >= 200 && r.status < 300).length,
        rateLimited: burstResults.filter(r => r.status === 429).length,
        errors: burstResults.filter(r => r.status === 0 || (r.status >= 400 && r.status !== 429)).length,
        averageResponseTime: burstResults.reduce((sum, r) => sum + r.responseTime, 0) / burstResults.length,
      },
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rate-limit-test-${new Date().toISOString().slice(0, 19)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'bg-green-100 text-green-800';
    if (status === 429) return 'bg-yellow-100 text-yellow-800';
    if (status >= 400) return 'bg-red-100 text-red-800';
    return 'bg-gray-100 text-gray-800';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Advanced Rate Limit Tester</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="single" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="single">Single Request</TabsTrigger>
            <TabsTrigger value="burst">Burst Testing</TabsTrigger>
          </TabsList>
          
          <TabsContent value="single" className="space-y-4">
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">Test Endpoint</Label>
                <div className="flex rounded-md shadow-sm">
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger className="w-24 rounded-r-none border-r-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="PUT">PUT</SelectItem>
                      <SelectItem value="DELETE">DELETE</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    className="flex-1 rounded-l-none border-l-0 rounded-r-none font-mono text-sm"
                    placeholder="/api/protected/test"
                  />
                  <Button
                    onClick={sendRequest}
                    disabled={isLoading}
                    className="rounded-l-none border-l-0"
                    size="sm"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <Label htmlFor="headers" className="text-sm font-medium mb-2 block">
                  Headers (JSON)
                </Label>
                <Textarea
                  id="headers"
                  value={headers}
                  onChange={(e) => setHeaders(e.target.value)}
                  placeholder='{"X-API-Key": "test-key", "X-Client-ID": "client-123"}'
                  className="font-mono text-sm"
                  rows={3}
                />
              </div>

              <div>
                <Label htmlFor="response" className="text-sm font-medium mb-2 block">
                  Response
                </Label>
                <Textarea
                  id="response"
                  value={response}
                  readOnly
                  className="font-mono text-sm bg-gray-50"
                  rows={10}
                  placeholder="Response will appear here..."
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="burst" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="burstCount" className="text-sm font-medium mb-2 block">
                  Number of Requests
                </Label>
                <Input
                  id="burstCount"
                  type="number"
                  value={burstCount}
                  onChange={(e) => setBurstCount(Number(e.target.value))}
                  min="1"
                  max="200"
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Simulate burst traffic (1-200 requests)
                </p>
              </div>

              <div>
                <Label htmlFor="burstDelay" className="text-sm font-medium mb-2 block">
                  Delay Between Requests (ms)
                </Label>
                <Input
                  id="burstDelay"
                  type="number"
                  value={burstDelay}
                  onChange={(e) => setBurstDelay(Number(e.target.value))}
                  min="0"
                  max="5000"
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  0ms = No delay (instant burst)
                </p>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Test Configuration</Label>
              <div className="flex rounded-md shadow-sm mb-4">
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="w-24 rounded-r-none border-r-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="PUT">PUT</SelectItem>
                    <SelectItem value="DELETE">DELETE</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  className="flex-1 rounded-none border-l-0 font-mono text-sm"
                  placeholder="/api/protected/test"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={startBurstTest}
                disabled={isBurstTesting}
                className="flex-1"
              >
                <Play className="h-4 w-4 mr-2" />
                Start Burst Test
              </Button>
              
              {isBurstTesting && (
                <Button 
                  onClick={stopBurstTest}
                  variant="destructive"
                >
                  <Square className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              )}
              
              {burstResults.length > 0 && (
                <>
                  <Button 
                    onClick={clearResults}
                    variant="outline"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Clear
                  </Button>
                  
                  <Button 
                    onClick={exportResults}
                    variant="outline"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                </>
              )}
            </div>

            {isBurstTesting && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{Math.round(burstProgress)}%</span>
                </div>
                <Progress value={burstProgress} className="w-full" />
              </div>
            )}

            {burstResults.length > 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">
                      {burstResults.length}
                    </div>
                    <div className="text-sm text-blue-600">Total</div>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">
                      {burstResults.filter(r => r.status >= 200 && r.status < 300).length}
                    </div>
                    <div className="text-sm text-green-600">Success</div>
                  </div>
                  <div className="text-center p-3 bg-yellow-50 rounded-lg">
                    <div className="text-2xl font-bold text-yellow-600">
                      {burstResults.filter(r => r.status === 429).length}
                    </div>
                    <div className="text-sm text-yellow-600">Rate Limited</div>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded-lg">
                    <div className="text-2xl font-bold text-red-600">
                      {burstResults.filter(r => r.status >= 400 && r.status !== 429).length}
                    </div>
                    <div className="text-sm text-red-600">Errors</div>
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium mb-2 block">
                    Test Results ({burstResults.length} requests)
                  </Label>
                  <div className="max-h-64 overflow-y-auto border rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left">#</th>
                          <th className="px-3 py-2 text-left">Status</th>
                          <th className="px-3 py-2 text-left">Time</th>
                          <th className="px-3 py-2 text-left">Remaining</th>
                          <th className="px-3 py-2 text-left">Response Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {burstResults.map((result, index) => (
                          <tr key={index} className="border-t hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono">{index + 1}</td>
                            <td className="px-3 py-2">
                              <Badge className={getStatusColor(result.status)}>
                                {result.status}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {new Date(result.timestamp).toLocaleTimeString()}
                            </td>
                            <td className="px-3 py-2 font-mono">
                              {result.rateLimitHeaders?.remaining || '-'}
                            </td>
                            <td className="px-3 py-2 font-mono">
                              {result.responseTime}ms
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}