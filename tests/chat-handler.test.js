import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import handler from "../api/chat.js";

const { chat, admission, record } = vi.hoisted(() => ({ chat: vi.fn(), admission: vi.fn(), record: vi.fn() }));
vi.mock("../lib/ebirdCore.js", () => ({ chatWithBirds: chat }));
vi.mock("../lib/chatAdmission.js", () => ({ enforceChatAdmission: admission }));
vi.mock("../lib/operationalEvents.js", () => ({ recordOperationalEvent: record }));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

function requestAndResponse() {
  const request = Object.assign(new EventEmitter(), { method: "POST", body: { messages: [{ role: "user", content: "Where are ospreys?" }] } });
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn(),
  });
  return { request, response };
}
beforeEach(() => { chat.mockReset(); admission.mockReset().mockResolvedValue(true); record.mockReset().mockResolvedValue({ recorded: true }); });

it.each(["request", "response"])("cancels Ask when the %s connection ends early", async (target) => {
  const { request, response } = requestAndResponse();
  let capturedSignal;
  chat.mockImplementation((_body, _key, { signal }) => {
    capturedSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  const pending = handler(request, response);
  await vi.waitFor(() => expect(chat).toHaveBeenCalled());
  if (target === "request") request.emit("aborted");
  else response.emit("close");
  await pending;

  expect(capturedSignal.aborted).toBe(true);
  expect(response.json).not.toHaveBeenCalled();
  expect(request.listenerCount("aborted")).toBe(0);
  expect(response.listenerCount("close")).toBe(0);
});

it("returns the bounded-timeout error and removes connection listeners", async () => {
  const { request, response } = requestAndResponse();
  chat.mockRejectedValue(Object.assign(new Error("The assistant could not finish in time."), { statusCode: 504 }));
  await handler(request, response);
  expect(response.status).toHaveBeenCalledWith(504);
  expect(response.json).toHaveBeenCalledWith({ error: "The assistant could not finish in time." });
  expect(request.listenerCount("aborted")).toBe(0);
  expect(response.listenerCount("close")).toBe(0);
});

it("returns a normal answer without leaving abort listeners behind", async () => {
  const { request, response } = requestAndResponse();
  chat.mockResolvedValue({ reply: "Source-backed answer." });
  await handler(request, response);
  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json).toHaveBeenCalledWith({ reply: "Source-backed answer." });
  expect(request.listenerCount("aborted")).toBe(0);
  expect(response.listenerCount("close")).toBe(0);
});


it("does not start paid work when shared admission is denied or unavailable", async () => {
  const { request, response } = requestAndResponse();
  admission.mockResolvedValueOnce(false);
  await handler(request, response);
  expect(chat).not.toHaveBeenCalled();
  admission.mockRejectedValueOnce(Object.assign(new Error("Ask is temporarily unavailable."), { statusCode: 503, code: "admission_unavailable" }));
  await handler(request, response);
  expect(chat).not.toHaveBeenCalled();
  expect(response.status).toHaveBeenCalledWith(503);
  expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "15");
  expect(record).toHaveBeenCalledWith({ route: "chat", httpStatus: 503, category: "admission" });
});

it("cancels admission before a model request starts when the visitor disconnects", async () => {
  const { request, response } = requestAndResponse();
  admission.mockImplementation((_req, _res, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const pending = handler(request, response);
  request.emit("aborted");
  await pending;
  expect(chat).not.toHaveBeenCalled();
  expect(response.json).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
});

it("rejects an empty question before consuming the shared allowance", async () => {
  const { request, response } = requestAndResponse();
  request.body = { messages: [] };
  await handler(request, response);
  expect(response.status).toHaveBeenCalledWith(400);
  expect(admission).not.toHaveBeenCalled();
});
