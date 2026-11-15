import { describe, it, expect } from "vitest";
import { userFacingError } from "@/lib/user-facing-error";

describe("userFacingError", () => {
  it("turns a LazyLibrarian 500 with an HTML page into one sentence, without the internal address", () => {
    const raw =
      'LazyLibrarian /api?cmd=addBook&apikey=***&id=11468377&wait=1: 500 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';
    expect(userFacingError(raw)).toBe("LazyLibrarian couldn't look this book up. An admin can retry it.");
  });

  it("explains a book LazyLibrarian accepted but never added", () => {
    expect(userFacingError("LazyLibrarian accepted book OL9W but didn't add it to its library")).toBe(
      "LazyLibrarian couldn't add this book. An admin can retry it.",
    );
  });

  it("explains unreachable services and auth problems", () => {
    expect(userFacingError("Radarr /api/v3/movie: network fetch failed")).toBe(
      "Radarr isn't reachable right now. Lexarr will try again.",
    );
    expect(userFacingError("Sonarr /api/v3/series: 401 Unauthorized")).toBe(
      "Lexarr couldn't sign in to Sonarr. An admin needs to check its settings.",
    );
    expect(userFacingError("Lidarr /api/v1/album/123: 404 Not Found")).toBe("Lidarr couldn't find this title.");
  });

  it("hides database internals, including inside a 'Check failed:' wrapper", () => {
    const raw = "Check failed: \nInvalid `prisma.request.update()` invocation:\n\nOperations timed out after `N/A`";
    expect(userFacingError(raw)).toBe(
      "Couldn't check this request's status: lexarr hit a database error with this request. It will try again.",
    );
  });

  it("keeps written reasons, minus markup and internal addresses", () => {
    expect(userFacingError("No releases found after 12h — indexers returned nothing")).toBe(
      "No releases found after 12h — indexers returned nothing",
    );
    expect(userFacingError("Download failed at <b>http://192.168.1.100:8080/api</b> (192.168.1.100:8080)")).toBe(
      "Download failed at",
    );
  });

  it("caps length and passes empty values through", () => {
    expect((userFacingError("x".repeat(500)) as string).length).toBe(200);
    expect(userFacingError(null)).toBeNull();
    expect(userFacingError(undefined)).toBeUndefined();
    expect(userFacingError("")).toBe("");
  });
});
