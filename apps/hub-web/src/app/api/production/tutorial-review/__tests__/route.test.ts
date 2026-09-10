import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const state=vi.hoisted(()=>({session:{userId:"va",role:"TUTORIAL_VA"} as unknown,batches:[] as unknown[][],queries:[] as unknown[],availability:vi.fn(),config:vi.fn()}));
vi.mock("@/lib/auth/session",()=>({getSession:async()=>state.session}));
vi.mock("@/lib/auth/rbac",()=>({hasPermission:(_session:unknown,p:string)=>p==="view:production"}));
vi.mock("@/lib/config",()=>({getHubConfig:()=>({LOCAL_MEDIA_ROOT:"/safe/media"})}));
vi.mock("@repo/storage",()=>({loadStorageConfigFromDatabase:state.config}));
vi.mock("@/lib/tutorial/media-availability",()=>({reviewMediaAvailability:state.availability}));
vi.mock("@/lib/db",async()=>{
  const schema=await import("@repo/db");
  return {...schema,db:{select:()=>{const chain={from:()=>chain,leftJoin:()=>chain,where:(q:unknown)=>{state.queries.push(q);return chain;},orderBy:()=>chain,limit:async()=>state.batches.shift()??[],then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(state.batches.shift()??[]).then(resolve)};return chain;}}};
});
const {GET}=await import("../route");
beforeEach(()=>{
  vi.clearAllMocks();state.session={userId:"va",role:"TUTORIAL_VA"};state.queries=[];
  state.batches=[[{id:"owned-job",title:"Title",language:"en",channelId:"channel",finalPath:"/safe/media/final.mp4",completedAt:new Date(),durationS:null,createdBy:"va",reviewStatus:"pending"}],[],[],[]];
  state.config.mockResolvedValue({enabled:true});
  state.availability.mockResolvedValue({playable:true,localAvailable:false,receiptRecorded:true,restoreEligible:true,archiveCurrentBytesVerified:false,availabilityReason:"verified_receipt_restore_eligible"});
});
it("does not resolve availability or storage configuration before authorization",async()=>{
  state.session=null;expect((await GET(new Request("http://localhost"))).status).toBe(403);expect(state.queries).toHaveLength(0);expect(state.config).not.toHaveBeenCalled();expect(state.availability).not.toHaveBeenCalled();
});
it("keeps a VA's all-scope request ownership-scoped and emits distinct receipt/restore facts",async()=>{
  const response=await GET(new Request("http://localhost?scope=all"));const body=await response.json();
  expect(body.scope).toBe("mine");expect(new PgDialect().sqlToQuery(state.queries[0] as never).params).toContain("va");
  expect(body.jobs[0]).toMatchObject({playable:true,inDrive:true,receiptRecorded:true,restoreEligible:true,archiveCurrentBytesVerified:false});
  expect(JSON.stringify(body)).not.toContain("/safe/media");
  expect(state.availability).toHaveBeenCalledWith("owned-job","/safe/media/final.mp4",[],{allowedRoots:["/safe/media"],maxBytes:8*1024**3,driveConfigured:true});
});
it("allows explicit administrator all-scope without changing availability requirements",async()=>{
  state.session={userId:"admin",role:"ADMIN"};state.config.mockResolvedValue({enabled:false});
  const body=await (await GET(new Request("http://localhost?scope=all"))).json();expect(body.scope).toBe("all");
  expect(new PgDialect().sqlToQuery(state.queries[0] as never).params).not.toContain("admin");
  expect(state.availability).toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.anything(),expect.objectContaining({driveConfigured:false}));
});
const deepId = "d49fd231-e269-41ab-9021-ec1f0ca12c5d";
it("loads an old authorized exact review independently of lookback and reviewed state", async () => {
  const original = state.batches[0]![0] as Record<string, unknown>;
  state.batches[0] = [{ ...original, id: deepId, completedAt: new Date("2020-01-01"), reviewStatus: "approved" }];
  state.batches.unshift([{ id: deepId, createdBy: "va", status: "COMPLETED", sourceJobId: null, language: "en" }]);
  const response = await GET(new Request(`http://localhost?hours=1&jobId=${deepId}`));
  expect(response.status).toBe(200); expect((await response.json()).jobs[0]).toMatchObject({ id: deepId, reviewStatus: "approved" });
  const query = new PgDialect().sqlToQuery(state.queries[1] as never); expect(query.params).toContain(deepId); expect(query.params).toContain("va"); expect(query.params.some(value => value instanceof Date)).toBe(false); expect(query.sql).not.toContain(">=");
});
it("does not expose another VA's linked job or resolve its media", async () => {
  state.batches = [[{ id: deepId, createdBy: "other", status: "COMPLETED", language: "en" }]];
  const response = await GET(new Request(`http://localhost?jobId=${deepId}&scope=all`)); expect(response.status).toBe(404); expect(state.queries).toHaveLength(1); expect(state.availability).not.toHaveBeenCalled(); expect(state.config).not.toHaveBeenCalled();
});
it("gives a clear unavailable response for a missing explicit job", async () => { state.batches = [[]]; expect((await GET(new Request(`http://localhost?jobId=${deepId}`))).status).toBe(404); expect(state.availability).not.toHaveBeenCalled(); });
it("does not substitute another job when the exact job is not ready", async () => { state.batches = [[{ id: deepId, createdBy: "va", status: "RECORDING", language: "en" }]]; expect((await GET(new Request(`http://localhost?jobId=${deepId}`))).status).toBe(409); expect(state.queries).toHaveLength(1); });
it("validates exact IDs before database lookup", async () => { expect((await GET(new Request("http://localhost?jobId=bad"))).status).toBe(400); expect(state.queries).toHaveLength(0); });
it("an empty explicit ID is invalid rather than a request for the normal queue", async () => { expect((await GET(new Request("http://localhost?jobId="))).status).toBe(400); expect(state.queries).toHaveLength(0); });
it("an Admin direct link to another VA authorizes all-scope locale follow-up without a scope toggle", async () => {
  state.session = { userId: "admin", role: "ADMIN" };
  state.batches[0] = [{ ...(state.batches[0]![0] as Record<string, unknown>), id: deepId }];
  state.batches.unshift([{ id: deepId, createdBy: "va", status: "COMPLETED", sourceJobId: null, language: "en" }]);
  const response = await GET(new Request(`http://localhost?jobId=${deepId}`)); expect(response.status).toBe(200); expect((await response.json()).scope).toBe("all"); expect(new PgDialect().sqlToQuery(state.queries[1] as never).params).not.toContain("admin");
});
