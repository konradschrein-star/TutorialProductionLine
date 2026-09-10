import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({session:{userId:"uploader",role:"UPLOADER_VA"} as unknown, job:{} as Record<string,unknown>, allowed:true, verify:vi.fn(), stream:vi.fn(), media: {} as Record<string, unknown>}));
vi.mock("@/lib/auth/session",()=>({getSession:async()=>state.session}));
vi.mock("@/lib/auth/rbac",()=>({hasPermission:()=>true}));
vi.mock("@/lib/tutorial/delivery-access",()=>({mayAccessDelivery:async()=>state.allowed}));
vi.mock("@/lib/tutorial/verify-publication-approval",()=>({verifyPublicationApproval:(...args:unknown[])=>state.verify(...args)}));
vi.mock("@/lib/tutorial/media-access",()=>({openTutorialAssetStream:async(request:unknown,options:unknown)=>{state.stream(request,options);return {size:9,status:200,contentLength:9,...state.media,stream:new ReadableStream({start(controller){controller.enqueue(Buffer.from("testvideo"));controller.close();}})};}}));
vi.mock("@/lib/db",()=>{
 const db={query:{tutorialJobs:{findFirst:async()=>state.job}},select:()=>{const chain={from:()=>chain,where:()=>chain,for:async()=>[state.job]};return chain;},transaction:async(fn:(tx:unknown)=>unknown)=>fn(db)};
 return{db,tutorialJobs:{id:{}},tutorialSourceRevision:()=>"revision"};
});
const {GET}=await import("../route");
const id="11111111-1111-4111-8111-111111111111";
const get=(suffix="",jobId=id)=>GET(new Request(`http://localhost/api/production/jobs/${jobId}/download${suffix}`),{params:Promise.resolve({id:jobId})});
beforeEach(()=>{vi.clearAllMocks();state.allowed=true;state.session={userId:"uploader",role:"UPLOADER_VA"};state.job={id,status:"COMPLETED",source_job_id:null,created_by:"producer",publication_approval:{revision:"approved"},va_review_status:"approved",final_path:"/media/final.mp4",recording_path:"/media/raw.mp4",title:"Test",language:"en"};state.verify.mockResolvedValue({revision:"approved"});});
describe("approved manual video download",()=>{
 beforeEach(()=>{state.media={};});
 it("rejects unauthenticated and malformed requests",async()=>{state.session=null;expect((await get()).status).toBe(403);state.session={userId:"uploader",role:"UPLOADER_VA"};expect((await get("","invalid")).status).toBe(400);expect(state.stream).not.toHaveBeenCalled();});
 it("does not stream another team's video",async()=>{state.allowed=false;expect((await get()).status).toBe(403);expect(state.stream).not.toHaveBeenCalled();});
 it("does not treat an approval marker as proof of current bytes",async()=>{state.verify.mockRejectedValue(new Error("changed bytes"));expect((await get()).status).toBe(409);expect(state.stream).not.toHaveBeenCalled();});
 it("requires source final review",async()=>{state.job.va_review_status="pending";expect((await get()).status).toBe(409);expect(state.stream).not.toHaveBeenCalled();});
 it("rejects a stale requested package revision",async()=>{expect((await get("?approvalRevision=older")).status).toBe(409);expect(state.stream).not.toHaveBeenCalled();});
 it("streams the approved final video after verification",async()=>{const response=await get("?approvalRevision=approved");expect(response.status).toBe(200);expect(await response.text()).toBe("testvideo");expect(state.verify).toHaveBeenCalledOnce();});
 it("forwards a byte range and supports inline video playback after approval",async()=>{state.media={status:206,contentLength:3,contentRange:"bytes 2-4/9"};const response=await GET(new Request(`http://localhost/api/production/jobs/${id}/download?inline=1`,{headers:{Range:"bytes=2-4"}}),{params:Promise.resolve({id})});expect(response.status).toBe(206);expect(response.headers.get("content-range")).toBe("bytes 2-4/9");expect(response.headers.get("content-length")).toBe("3");expect(response.headers.get("accept-ranges")).toBe("bytes");expect(response.headers.get("content-disposition")).toContain("inline;");expect(state.stream).toHaveBeenCalledWith(expect.anything(),{range:"bytes=2-4"});expect(state.verify).toHaveBeenCalledOnce();});
 it("returns an unsatisfiable range response from the verified stream adapter",async()=>{state.media={status:416,contentLength:0,contentRange:"bytes */9"};const response=await get();expect(response.status).toBe(416);expect(response.headers.get("content-range")).toBe("bytes */9");});
});
