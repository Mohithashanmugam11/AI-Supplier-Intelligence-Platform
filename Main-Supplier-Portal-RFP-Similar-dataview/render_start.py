import os
import uvicorn

if __name__ == "__main__":
    port = int(os.getenv("PORT", "10000"))
    uvicorn.run(
        "unified.backend.app:app",
        host="0.0.0.0",
        port=port,
        workers=1,
        lifespan="off",
        log_level="info",
    )
