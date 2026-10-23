/** `POST /api/enter`: Naive posts the viewer's ticket here when someone opens Media manager (§29.10). */
import { enter } from "@usenaive-sdk/app";

export const POST = (request: Request) => enter(request, process.env);
