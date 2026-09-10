import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({job:vi.fn(),session:vi.fn(),media:vi.fn()}));
vi.mock("@/lib/auth/session",()=>({getSession:mocks.session}));
vi.mock("@/lib/auth/rbac",()=>({hasPermission:(_session:unknown,p:string)=>p==="view:production"}));
vi.mock("@/lib/db",()=>({db:{}}));
vi.mock("@repo/db",()=>({getTutorialJobById:mocks.job,updateTutorialJob:vi.fn()}));
vi.mock("@/lib/production/publish-recording",()=>({publishRecording:vi.fn()}));
vi.mock("@/lib/tutorial/media-access",()=>({openTutorialAssetStream:mocks.media}));
const recording=await import("../recording/route");
const audio=await import("../audio/route");
const longAudio=await import("../long-audio/route");
const request=()=>new Request("http://localhost",{headers:{range:"bytes=-3","if-none-match":"old"}}) as never;
const params={params:Promise.resolve({id:"child"})};
beforeEach(()=>{
 vi.clearAllMocks();mocks.session.mockResolvedValue({userId:"va",role:"TUTORIAL_VA"});
 mocks.job.mockResolvedValue({id:"child",source_job_id:"source",created_by:"va",recording_path:"/media/source.mp4",audio_path:"/media/child.mp3",long_audio_path:"/media/long.mp3",title:"My Tutorial"});
 mocks.media.mockImplementation(async()=>({status:206,contentLength:3,contentRange:"bytes 7-9/10",etag:'"10-123"',lastModified:new Date(0).toUTCString(),stream:new ReadableStream({start(c){c.enqueue(Buffer.from("end"));c.close();}})}));
});
it("routes a child recording to the exact source archive with inline/range/no-store preserved",async()=>{
 const response=await recording.GET(request(),params);expect(response.status).toBe(206);expect(await response.text()).toBe("end");expect(response.headers.get("content-range")).toBe("bytes 7-9/10");expect(response.headers.get("cache-control")).toBe("no-store");expect(response.headers.get("content-disposition")).toBe("inline");
 expect(mocks.media).toHaveBeenCalledWith({jobId:"source",kind:"raw_recording",path:"/media/source.mp4"},{range:"bytes=-3"});
});
it.each([["audio",audio.GET,"/media/child.mp3"],["long audio",longAudio.GET,"/media/long.mp3"]] as const)("keeps %s local-only with revalidation and ranged streaming",async(_label,get,path)=>{
 const response=await get(request(),params);expect(response.status).toBe(206);expect(response.headers.get("cache-control")).toBe("private, no-cache");expect(response.headers.get("etag")).toBe('"10-123"');expect(response.headers.get("content-length")).toBe("3");
 expect(mocks.media).toHaveBeenCalledWith({jobId:"child",kind:null,path},{range:"bytes=-3",ifNoneMatch:"old"});
 if(_label==="long audio")expect(response.headers.get("content-disposition")).toContain("attachment;");
});
it.each([recording.GET,audio.GET,longAudio.GET])("does not acquire media for another owner's preview",async get=>{
 mocks.job.mockResolvedValue({created_by:"other"});expect((await get(request(),params)).status).toBe(403);expect(mocks.media).not.toHaveBeenCalled();
});
it.each([audio.GET,longAudio.GET])("serves a304 without a body and without losing validators",async get=>{
 mocks.media.mockResolvedValue({status:304,etag:'"same"',lastModified:new Date(0).toUTCString(),stream:new ReadableStream({start(c){c.close();}})});
 const response=await get(request(),params);expect(response.status).toBe(304);expect(await response.text()).toBe("");expect(response.headers.get("etag")).toBe('"same"');
});
