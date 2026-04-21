import { azureProtocol, getAzureProtocolForBaseUrl } from "./src/providers/adapters/customizations/azure";

const request = {
  model: "gpt-5.4-pro",
  messages: [{ role: "user", content: "hello" }],
  maxTokens: 16384,
  temperature: 1.0,
  stream: false
};

const baseUrl = "https://ragagent-siro.openai.azure.com/openai/v1";
const p = getAzureProtocolForBaseUrl(baseUrl);
console.log(JSON.stringify(p.buildRequestBody(request as any), null, 2));
