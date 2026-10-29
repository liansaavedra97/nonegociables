import threading, http.server, functools, socketserver
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.webmanifest':'application/manifest+json', '.js':'text/javascript'}
import os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def start(root=ROOT, port=8766):
    socketserver.TCPServer.allow_reuse_address=True
    h=functools.partial(Q, directory=root)
    s=socketserver.ThreadingTCPServer(('127.0.0.1',port),h)
    t=threading.Thread(target=s.serve_forever,daemon=True); t.start()
    return s
