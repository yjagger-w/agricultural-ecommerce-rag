# License and modification notices

This project is distributed under GNU GPL version 3 only; see LICENSE. It comes with no warranty.

Portions of the text normalization/tokenization, prompt section assembly, streaming request adapter and SSE parsing are derived from GPL-3.0 code authored by Pickle Team. Existing source contained no additional file-level copyright notices in those portions. Author attribution is retained here and in the adapted files.

Modified on 2026-09-26: removed desktop, audio, personal-profile and interview dependencies; added agricultural evidence boundaries, abort handling and strict stream validation. The remaining domain logic, HTTP API, import validation and tests were independently implemented for this prototype.

Node.js is an external runtime dependency and is not bundled. There are no installed npm dependencies in this repository.
