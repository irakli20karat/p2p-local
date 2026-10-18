import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownToLine, ArrowLeft, ChevronRight, File, Folder, FolderOpen, HardDrive, MessageCircle, Send, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function joinPath(directory, filename) {
    return directory ? `${directory}/${filename}` : filename;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(1)} ${units[index]}`;
}

function formatMB(bytes) {
    return `${(Math.max(0, bytes || 0) / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    const value = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = value % 60;
    return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${secs}s` : `${secs}s`;
}

function detectDeviceName() {
    const ua = navigator.userAgent;
    const platform = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
        : /Android/.test(ua) ? 'Android'
            : /Windows/.test(ua) ? 'Windows'
                : /Mac OS X/.test(ua) ? 'macOS'
                    : /CrOS/.test(ua) ? 'ChromeOS'
                        : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
    const browser = /Edg\//.test(ua) ? 'Edge'
        : /Firefox\//.test(ua) ? 'Firefox'
            : /Chrome\//.test(ua) ? 'Chrome'
                : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return `${platform} · ${browser}`;
}

function SpeedGraph({ points = [], striped = false, compact = false, label = 'Download speed over the last 60 seconds' }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;

        const draw = () => {
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            if (!width || !height) return;
            const ratio = window.devicePixelRatio || 1;
            canvas.width = width * ratio;
            canvas.height = height * ratio;
            const context = canvas.getContext('2d');
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            context.clearRect(0, 0, width, height);
            const background = striped ? '#F4F4F5' : '#FFFFFF';
            context.fillStyle = background;
            context.fillRect(0, 0, width, height);

            const padding = { left: 8, right: 8, top: 6, bottom: 6 };
            const plotWidth = width - padding.left - padding.right;
            const plotHeight = height - padding.top - padding.bottom;
            const maxSpeed = Math.max(1024, ...points.map(point => point.speed)) * 1.12;
            context.strokeStyle = 'rgba(42, 160, 55, 0.14)';
            context.lineWidth = 1;
            for (let index = 0; index <= 4; index++) {
                const y = padding.top + index / 4 * plotHeight;
                context.beginPath();
                context.moveTo(padding.left, y);
                context.lineTo(width - padding.right, y);
                context.stroke();
            }
            for (let index = 0; index <= 20; index++) {
                const x = padding.left + index / 20 * plotWidth;
                context.beginPath();
                context.moveTo(x, padding.top);
                context.lineTo(x, height - padding.bottom);
                context.stroke();
            }
            if (!points.length) return;

            const lastTime = points[points.length - 1].time;
            const coordinates = points.map(point => ({
                x: padding.left + Math.max(0, plotWidth - ((lastTime - point.time) / 60000) * plotWidth),
                y: padding.top + plotHeight * (1 - point.speed / maxSpeed)
            }));
            const gradient = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
            gradient.addColorStop(0, 'rgba(18, 177, 48, 0.78)');
            gradient.addColorStop(1, 'rgba(18, 177, 48, 0.58)');
            context.beginPath();
            context.moveTo(coordinates[0].x, height - padding.bottom);
            coordinates.forEach(point => context.lineTo(point.x, point.y));
            context.lineTo(coordinates[coordinates.length - 1].x, height - padding.bottom);
            context.closePath();
            context.fillStyle = gradient;
            context.fill();
            context.beginPath();
            coordinates.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
            context.strokeStyle = '#0C9C2C';
            context.lineWidth = 1.8;
            context.lineJoin = 'round';
            context.lineCap = 'round';
            context.stroke();
        };

        draw();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
        observer?.observe(canvas);
        return () => observer?.disconnect();
    }, [points, striped]);

    return <canvas ref={canvasRef} className={`peer-graph-grid ${compact ? 'h-12 w-[190px]' : 'h-[104px] w-full'}`} role="img" aria-label={label} />;
}

function PeerIdentity({ peer }) {
    return <div className="min-w-[145px]">
        <div className="font-medium text-foreground">{peer.ip}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{[peer.deviceName, peer.nickname].filter(Boolean).join(' · ') || 'Unknown device'}</div>
    </div>;
}

function PeerTable({ peers = [] }) {
    if (!peers.length) return null;
    return <div className="mt-3 overflow-x-auto rounded-lg border bg-background">
        <Table className="min-w-[780px] text-xs">
            <TableHeader><TableRow className="hover:bg-transparent">
                {['Peer', 'Progress', 'Downloaded', 'Left', 'Speed', 'ETA', 'Elapsed'].map(label => <TableHead key={label}>{label}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>{peers.map(peer => <TableRow key={peer.id}>
                <TableCell><PeerIdentity peer={peer} /></TableCell>
                <TableCell>{peer.percent.toFixed(1)}%</TableCell>
                <TableCell>{formatMB(peer.downloaded)}</TableCell>
                <TableCell>{formatMB(peer.left)}</TableCell>
                <TableCell>{formatBytes(peer.speed)}/s</TableCell>
                <TableCell className="font-medium text-emerald-700">{formatDuration(peer.eta)}</TableCell>
                <TableCell>{formatDuration(peer.elapsed)}</TableCell>
            </TableRow>)}</TableBody>
        </Table>
    </div>;
}

function TrackerDownloads({ downloads }) {
    if (!downloads.length) return <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 rounded-full bg-muted p-3 text-muted-foreground"><Activity className="h-5 w-5" /></div>
        <p className="font-medium">No active downloads</p>
        <p className="mt-1 text-sm text-muted-foreground">Transfers will appear here as clients start downloading files.</p>
    </div>;

    return <Table className="min-w-[1320px]">
        <TableHeader><TableRow className="hover:bg-transparent">
            {['File', 'Peer', 'Progress', 'Downloaded', 'Left', 'Speed', 'ETA', 'Elapsed', 'Speed · 60s'].map(label => <TableHead key={label}>{label}</TableHead>)}
        </TableRow></TableHeader>
        <TableBody>{downloads.map((download, index) => {
            const striped = index % 2 === 1;
            return <TableRow key={download.id} className={striped ? 'download-row-striped' : ''}>
                <TableCell className="min-w-[210px]">
                    <span className="block max-w-[230px] truncate font-medium text-foreground" title={download.fileName}>{download.fileName}</span>
                    <span className="mt-1 block max-w-[230px] truncate text-xs text-muted-foreground" title={download.filePath}>{download.filePath}</span>
                </TableCell>
                <TableCell><PeerIdentity peer={download} /></TableCell>
                <TableCell className="min-w-[130px]"><div className="mb-1.5 text-xs tabular-nums">{download.percent.toFixed(1)}%</div><Progress value={download.percent} /></TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{formatMB(download.downloaded)}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{formatMB(download.left)}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{formatBytes(download.speed)}/s</TableCell>
                <TableCell className="whitespace-nowrap font-medium text-emerald-700">{formatDuration(download.eta)}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{formatDuration(download.elapsed)}</TableCell>
                <TableCell className="w-[210px] p-2"><SpeedGraph points={download.speedHistory || []} striped={striped} compact label={`Download speed for ${download.ip} over the last 60 seconds`} /></TableCell>
            </TableRow>;
        })}</TableBody>
    </Table>;
}

function App() {
    const socketRef = useRef(null);
    const messagesEndRef = useRef(null);
    const [serverInfo, setServerInfo] = useState(null);
    const [serverError, setServerError] = useState('');
    const [currentPath, setCurrentPath] = useState('');
    const [directory, setDirectory] = useState(null);
    const [directoryLoading, setDirectoryLoading] = useState(true);
    const [directoryError, setDirectoryError] = useState('');
    const [downloadPeers, setDownloadPeers] = useState({});
    const [canViewTracker, setCanViewTracker] = useState(false);
    const [trackerSnapshot, setTrackerSnapshot] = useState({ downloads: [], totalSpeed: 0 });
    const [view, setView] = useState('files');
    const [chatOpen, setChatOpen] = useState(false);
    const [nameDialogOpen, setNameDialogOpen] = useState(false);
    const [nickname, setNickname] = useState('');
    const [ownUsername, setOwnUsername] = useState('');
    const [nicknameInput, setNicknameInput] = useState('');
    const [messages, setMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [chatConnected, setChatConnected] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/server-info').then(response => {
            if (!response.ok) throw new Error(`Could not load server information (${response.status}).`);
            return response.json();
        }).then(info => { if (!cancelled) setServerInfo(info); })
            .catch(error => { if (!cancelled) setServerError(error.message); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        setDirectoryLoading(true);
        setDirectoryError('');
        fetch(`/api/browse/${encodeURI(currentPath)}`).then(async response => {
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || `Could not load this folder (${response.status}).`);
            }
            return response.json();
        }).then(data => { if (!cancelled) setDirectory(data); })
            .catch(error => { if (!cancelled) setDirectoryError(error.message); })
            .finally(() => { if (!cancelled) setDirectoryLoading(false); });
        return () => { cancelled = true; };
    }, [currentPath]);

    useEffect(() => {
        const socket = window.io();
        socketRef.current = socket;
        socket.on('connect', () => {
            setChatConnected(true);
            socket.emit('peer-info', { deviceName: detectDeviceName() });
        });
        socket.on('disconnect', () => {
            setChatConnected(false);
        });
        socket.on('tracker-access', allowed => setCanViewTracker(Boolean(allowed)));
        socket.on('tracker-update', snapshot => setTrackerSnapshot(snapshot));
        socket.on('download-peers', ({ filePath, peers }) => {
            setDownloadPeers(previous => ({ ...previous, [filePath]: peers }));
        });
        socket.on('username-assigned', username => {
            setOwnUsername(username);
            addSystemMessage(`Your secure username: ${username}`);
        });
        socket.on('user-joined', data => {
            addSystemMessage(`${data.user.username} (${data.user.displayName}) joined the chat`);
        });
        socket.on('user-left', data => {
            addSystemMessage(`${data.user.username} left the chat`);
        });
        socket.on('chat-message', message => setMessages(previous => [...previous, { ...message, kind: 'chat' }]));
        return () => { socket.disconnect(); socketRef.current = null; };
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages]);

    const files = useMemo(() => [...(directory?.files || [])].sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
    }), [directory]);

    const openChat = () => {
        setChatOpen(true);
        if (!nickname) setNameDialogOpen(true);
    };

    function addSystemMessage(text) {
        setMessages(previous => [...previous, { id: `${Date.now()}-${Math.random()}`, kind: 'system', text }]);
    }

    function joinChat(event) {
        event?.preventDefault();
        const displayName = nicknameInput.trim();
        if (!displayName || !socketRef.current) return;
        setNickname(displayName);
        setNameDialogOpen(false);
        socketRef.current.emit('join-chat', displayName);
        addSystemMessage(`Welcome to the chat, ${displayName}!`);
    }

    function sendMessage(event) {
        event.preventDefault();
        const message = chatInput.trim();
        if (!message || !chatConnected || !socketRef.current) return;
        socketRef.current.emit('chat-message', { message });
        setChatInput('');
    }

    function downloadFile(filePath) {
        const peerId = socketRef.current?.id || '';
        window.open(`/download/${encodeURI(filePath)}?peerId=${encodeURIComponent(peerId)}`, '_blank', 'noopener');
    }

    function navigateTo(path) {
        setCurrentPath(path === '.' ? '' : path);
    }

    const totalDownloaded = trackerSnapshot.downloads.reduce((total, download) => total + download.downloaded, 0);

    return <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto w-full max-w-screen-2xl space-y-5 px-4 py-6 sm:px-4 lg:py-8">
            <Card>
                <CardContent className="grid gap-5 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
                    {serverError ? <p className="text-sm text-destructive sm:col-span-2 lg:col-span-3">{serverError}</p> : !serverInfo ? <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">Loading…</p> : <>
                        <InfoField label="Hostname" value={serverInfo.hostname} />
                        <InfoField label="Directory" value={serverInfo.serveDir} />
                        <div className="min-w-0">
                            <div className="text-xs font-medium text-muted-foreground">Local addresses</div>
                            <div className="mt-1 flex flex-wrap gap-2">{serverInfo.networkIPs?.length ? serverInfo.networkIPs.map(ip => <Badge key={ip.address} variant="secondary" className="rounded-md font-normal">{ip.address}:{serverInfo.port} <span className="ml-1 text-muted-foreground">{ip.interface}</span></Badge>) : <span className="text-sm">None detected</span>}</div>
                        </div>
                        <div className="min-w-0">
                            <div className="text-xs font-medium text-muted-foreground">External address</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2">{serverInfo.externalIP ? <Badge variant="outline" className="rounded-md font-normal">{serverInfo.externalIP}:{serverInfo.port}</Badge> : <span className="text-sm">None detected</span>}{serverInfo.externalIP && <span className="flex items-center gap-1 text-xs text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" />Port forwarding may be required</span>}</div>
                        </div>
                    </>}
                </CardContent>
            </Card>

            <Card className="overflow-hidden">
                <div className="p-5 sm:p-6">
                    <Tabs value={view} onValueChange={setView}>
                        <TabsList>
                            <TabsTrigger value="files"><FolderOpen />Files</TabsTrigger>
                            {canViewTracker && <TabsTrigger value="tracker"><Activity />Tracker</TabsTrigger>}
                        </TabsList>
                        <div className="overflow-hidden">
                            <div className={`flex transition-transform duration-300 ease-in-out motion-reduce:transition-none ${canViewTracker ? 'w-[200%]' : 'w-full'} ${canViewTracker && view === 'tracker' ? '-translate-x-1/2' : 'translate-x-0'}`}>
                        <TabsContent forceMount value="files" inert={view !== 'files' ? '' : undefined} className={`mt-4 min-w-0 shrink-0 ${canViewTracker ? 'w-1/2' : 'w-full'}`}>
                            <div className="mb-3 flex min-h-10 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                                {directory?.parent !== null && directory?.parent !== undefined && <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => navigateTo(directory.parent)} aria-label="Go up one folder"><ArrowLeft className="h-4 w-4" /></Button>}
                                <span className="font-medium text-foreground">/</span>
                                {currentPath.split('/').filter(Boolean).map((part, index, parts) => <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-1.5"><ChevronRight className="h-3.5 w-3.5 shrink-0" /><button className="truncate hover:text-foreground" onClick={() => navigateTo(parts.slice(0, index + 1).join('/'))}>{part}</button></span>)}
                            </div>
                            <div className="overflow-hidden rounded-lg border bg-background">
                                {directoryLoading ? <div className="p-8 text-center text-sm text-muted-foreground">Loading files…</div> : directoryError ? <div className="p-8 text-center text-sm text-destructive">{directoryError}</div> : !files.length ? <div className="p-8 text-center text-sm text-muted-foreground">This folder is empty.</div> : files.map(file => {
                                    const filePath = joinPath(currentPath, file.name);
                                    const peers = downloadPeers[filePath] || [];
                                    return <div className="file-row" key={filePath}>
                                        <button className="flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/40 sm:px-5" onClick={() => file.isDirectory ? navigateTo(filePath) : downloadFile(filePath)}>
                                            <span className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground">{file.isDirectory ? <Folder className="h-5 w-5" /> : <File className="h-5 w-5" />}</span>
                                            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{file.name}</span><span className="mt-1 block text-xs text-muted-foreground">Modified {new Date(file.modified).toLocaleDateString()}</span></span>
                                            {!file.isDirectory && <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex"><ArrowDownToLine className="h-3.5 w-3.5" />{formatBytes(file.size)}</span>}
                                        </button>
                                        {!file.isDirectory && peers.length > 0 && <div className="px-4 pb-4 sm:px-5"><PeerTable peers={peers} /></div>}
                                    </div>;
                                })}
                            </div>
                        </TabsContent>
                        {canViewTracker && <TabsContent forceMount inert={view !== 'tracker' ? '' : undefined} value="tracker" className="mt-4 w-1/2 min-w-0 shrink-0 space-y-5">
                            <div className="grid gap-3 sm:grid-cols-3">
                                <SummaryCard label="Active downloads" value={String(trackerSnapshot.downloads.length)} icon={<ArrowDownToLine />} />
                                <SummaryCard label="Current throughput" value={`${formatBytes(trackerSnapshot.totalSpeed)}/s`} icon={<Activity />} />
                                <SummaryCard label="Downloaded by active peers" value={formatMB(totalDownloaded)} icon={<HardDrive />} />
                            </div>
                            <Card className="overflow-hidden">
                                <CardHeader className="border-b px-4 py-4 sm:px-5">
                                    <CardTitle>Active downloads</CardTitle>
                                </CardHeader>
                                <TrackerDownloads downloads={trackerSnapshot.downloads} />
                            </Card>
                        </TabsContent>}
                            </div>
                        </div>
                    </Tabs>
                </div>
            </Card>
        </main>

        {chatOpen ? <Card className="fixed inset-x-0 bottom-0 z-40 flex h-[min(540px,100dvh)] w-full flex-col overflow-hidden rounded-none shadow-xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[min(540px,calc(100vh-2.5rem))] sm:w-[380px] sm:rounded-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="text-sm font-semibold">Live chat</div>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setChatOpen(false)} aria-label="Close chat"><X /></Button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.map((message, index) => message.kind === 'system' ? <div key={message.id || index} className="text-center text-xs text-muted-foreground">{message.text}</div> : <div key={message.id || index} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${message.username === ownUsername ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    {message.username !== ownUsername && <div className="mb-1 text-xs font-semibold opacity-75">{message.username}</div>}
                    <div className="break-words">{message.message}</div>
                    <div className="mt-1 text-right text-[10px] opacity-60">{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>)}
                <div ref={messagesEndRef} />
            </div>
            <form className="flex gap-2 border-t p-3" onSubmit={sendMessage}>
                <Input value={chatInput} onChange={event => setChatInput(event.target.value)} placeholder={nickname ? 'Type a message…' : 'Join chat to send messages'} maxLength={500} disabled={!nickname || !chatConnected} />
                <Button size="icon" type="submit" disabled={!chatInput.trim() || !nickname || !chatConnected} aria-label="Send message"><Send /></Button>
            </form>
        </Card> : <Button size="icon" className="fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full shadow-lg" onClick={openChat} aria-label="Open live chat"><MessageCircle className="h-5 w-5" /></Button>}

        <Dialog open={nameDialogOpen} onOpenChange={setNameDialogOpen}>
            <DialogContent>
                <DialogHeader><DialogTitle>Join the live chat</DialogTitle><DialogDescription>Choose a nickname that other connected users will see.</DialogDescription></DialogHeader>
                <form className="mt-5 space-y-3" onSubmit={joinChat}>
                    <Input autoFocus value={nicknameInput} onChange={event => setNicknameInput(event.target.value)} placeholder="Your nickname" maxLength={20} />
                    <div className="flex justify-end"><Button type="submit" disabled={!nicknameInput.trim()}>Join chat</Button></div>
                </form>
            </DialogContent>
        </Dialog>
    </div>;
}

function InfoField({ label, value }) {
    return <div className="min-w-0"><div className="text-sm font-medium text-muted-foreground">{label}</div><div className="mt-1 break-all text-sm font-medium">{value}</div></div>;
}

function SummaryCard({ label, value, icon }) {
    return <Card><CardContent className="flex items-center justify-between p-4"><div><div className="text-xs font-medium text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</div></div><div className="rounded-lg bg-muted p-2 text-muted-foreground">{icon}</div></CardContent></Card>;
}

export default App;
