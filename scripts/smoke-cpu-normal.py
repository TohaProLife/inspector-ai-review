#!/usr/bin/env python3
"""CPU NORMAL queue acceptance for the committed image build; isolated owned Docker resources."""
import datetime
import hashlib
import http.cookiejar
import http.cookies
import json
import os
import pathlib
import re
import resource
import secrets
import selectors
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

import argparse

R = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir', type=pathlib.Path, required=True)
parser.add_argument('--images-json', type=pathlib.Path, required=True,
    help='Build receipt: revision, application images and infrastructure images by exact Docker image ID.')
parser.add_argument('--port', type=int, default=28186)
parser.add_argument('--full-source-pdf', type=pathlib.Path,
    help='Optional original F0201 (strict SHA/size): also run the real 676-page V4 audit through the queue.')
args = parser.parse_args()
if args.port < 1024 or args.port > 65535:
    parser.error('--port must be between 1024 and 65535')
P = args.output_dir.resolve()
P.mkdir(parents=True, exist_ok=True)
I = R / 'fixtures/cpu-normal-v1'
O = P / 'first-results'
OWNER = 'inspector-cpu-' + secrets.token_hex(6)
PORT = args.port
BASE = 'http://127.0.0.1:' + str(PORT)
CAPS = dict(postgres=768, rabbitmq=768, clamav=2048, migrate=1024, api=1024,
            relay=512, render=1024, extract=512, rules=384, link=384, web=128,
            signatures=2048)
if args.full_source_pdf:
    CAPS.update(render=3072, api=2048)
QUEUES = {'rules': 'rules.evaluate', 'render': 'documents.render',
          'extract': 'documents.extract', 'link': 'documents.link'}
INFRASTRUCTURE_DIGESTS = {
    'postgres': 'dca0d688bbb31d3f851502ffcb9c7791387b4fcc544ae434dab41761e5ece317',
    'rabbitmq': '11c9d525392fa42ea090550a6d2d8fca0d4c0d0e21912f91f7018296a3f66228',
    'clamav': '49a035c7b33154dc829bc15eff2fe44f1d07c63d3d20b681bf42e8e658d21152',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def pinned(ref):
    path = pathlib.Path(ref['path'])
    if not path.is_absolute():
        path = R / path
    b = path.read_bytes()
    require(sha(b) == ref['sha256'] and len(b) == ref['bytes'], 'Pin changed: ' + str(path))
    return b


def main():
    os.chdir(R)
    os.umask(0o077)
    O.mkdir(mode=0o700)  # Existing first-results is an unconditional refusal: never retry here.
    started = time.monotonic()
    deadline = started + 900
    phase = 'startup'
    records, checks, cleanup, redactions = [], [], [], []
    created, volume_names = {}, {}
    planned, network, ingress = {}, None, None
    network_plans = set()
    before = None
    error = None
    success = False
    private = None
    images = {}
    min_available_kib = None
    resource_red = False
    protected_unchanged = False

    def clean(data):
        for secret in redactions:
            if secret:
                data = data.replace(secret.encode(), b'<REDACTED>')
        return data

    def write(name, value, raw=False):
        data = value if raw else (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
        target = O / name
        with target.open('xb') as f:
            f.write(clean(data))
        target.chmod(0o600)

    def remaining(cap):
        nonlocal min_available_kib, resource_red
        if phase != 'cleanup':
            available = int(re.search(r'^MemAvailable:\s+(\d+) kB$', pathlib.Path('/proc/meminfo').read_text(), re.M).group(1))
            min_available_kib = available if min_available_kib is None else min(min_available_kib, available)
            if available < 1572864:
                resource_red = True
                raise RuntimeError('FIRST_RED_RESOURCE: MemAvailable below 1.5GiB; own cleanup')
        rem = deadline - time.monotonic()
        require(rem > 0, phase + ' total deadline exhausted')
        return min(cap, rem)

    with tempfile.TemporaryDirectory(prefix='inspector-cpu-private-') as private:
        private_path = pathlib.Path(private)
        # A separate, empty Docker configuration. Env files are siblings, not Docker auth data.
        docker_config = private_path / 'docker-empty'
        docker_config.mkdir(mode=0o700)
        env = {'PATH': '/usr/bin:/bin', 'HOME': private, 'DOCKER_CONFIG': str(docker_config), 'LANG': 'C.UTF-8'}
        docker = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock']

        def call(name, args, cap=30, check=True, persist=True, limit=8*1048576):
            cap = remaining(cap)
            begin = time.monotonic()
            def limits():
                resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            proc = subprocess.Popen(docker + args, env=env, stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    start_new_session=True, preexec_fn=limits)
            sel = selectors.DefaultSelector()
            sel.register(proc.stdout, selectors.EVENT_READ, 0)
            sel.register(proc.stderr, selectors.EVENT_READ, 1)
            buffers = [bytearray(), bytearray()]
            problem = None
            try:
                while sel.get_map():
                    if time.monotonic() - begin >= cap:
                        problem = 'TIMEOUT'
                        break
                    for key, _ in sel.select(min(0.2, max(0.001, cap-(time.monotonic()-begin)))):
                        chunk = os.read(key.fileobj.fileno(), 65536)
                        if not chunk:
                            sel.unregister(key.fileobj)
                            continue
                        index = key.data
                        bound = limit if index == 0 else 1048576
                        if len(buffers[index]) + len(chunk) > bound:
                            problem = 'OUTPUT_BOUND'
                            break
                        buffers[index].extend(chunk)
                    if problem:
                        break
                if problem:
                    os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=min(5, max(0.1, deadline-time.monotonic())))
            finally:
                sel.close()
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait(timeout=5)
                proc.stdout.close()
                proc.stderr.close()
            original_out, original_err = (bytes(b) for b in buffers)
            out, err = clean(original_out), clean(original_err)
            rec = {'name': name, 'operation': args[0], 'exitCode': proc.returncode,
                   'failure': problem, 'wallSeconds': round(time.monotonic()-begin, 3),
                   'stdoutSha256': sha(out), 'stdoutBytes': len(out),
                   'stderrSha256': sha(err), 'stderrBytes': len(err),
                   'stdoutWireSha256': sha(original_out), 'stderrWireSha256': sha(original_err),
                   'stdoutRedacted':out != original_out,'stderrRedacted':err != original_err}
            records.append(rec)
            if persist or problem or proc.returncode != 0:
                # Poll failures stay bounded; only metadata plus last error enter outcome.
                if persist:
                    write(name+'-stdout.bin', out, True)
                    write(name+'-stderr.bin', err, True)
                rec['stderrTail'] = err[-500:].decode(errors='replace')
            if check:
                require(proc.returncode == 0 and not problem,
                        name+': '+str(proc.returncode)+' '+str(problem)+' '+err[-500:].decode(errors='replace'))
            return proc.returncode, out

        def snapshot(name):
            return {kind: sorted(call(name+'-'+kind, [kind, 'ls', '-aq'] if kind == 'container'
                                      else [kind, 'ls', '-q'])[1].decode().splitlines())
                    for kind in ['container', 'volume', 'network']}

        def environment(name, values):
            file = private_path / (name+'.env')
            require(all('\n' not in v and '\r' not in v for v in values.values()), 'Invalid environment value')
            file.write_text(''.join(k+'='+v+'\n' for k, v in values.items()))
            file.chmod(0o600)
            return str(file)

        def inspect_own(role, cid, image):
            obj = json.loads(call('inspect-'+role+'-'+str(len(records)), ['inspect', cid])[1])[0]
            require(obj['Id'] == cid and obj['Name'] == '/'+OWNER+'-'+role
                    and obj['Image'] == image and obj['Config']['Labels'].get('inspector.owner') == OWNER,
                    'Ownership mismatch '+role)
            return obj

        def create(role, image, options, command=(), cpu=1, net=None):
            planned[role] = image
            args = ['create', '--pull=never', '--name', OWNER+'-'+role, '--label', 'inspector.owner='+OWNER,
                    '--network', net or network, '--network-alias', role, '--memory', str(CAPS[role])+'m',
                    '--memory-swap', str(CAPS[role])+'m', '--cpus', str(cpu), '--pids-limit', '256',
                    '--security-opt', 'no-new-privileges=true']
            # network-alias is legal only on the owned user-defined network.
            if net == 'none':
                pos = args.index('--network-alias')
                del args[pos:pos+2]
            cid = call(role+'-create', args + options + [image] + list(command))[1].decode().strip()
            require(re.fullmatch('[0-9a-f]{64}', cid), 'Invalid container ID')
            created[role] = (cid, image)
            obj = inspect_own(role, cid, image)
            h = obj['HostConfig']
            require(h['Memory'] == CAPS[role]*1048576 and h['MemorySwap'] == h['Memory']
                    and h['NanoCpus'] == int(cpu*1e9) and h['PidsLimit'] == 256,
                    'Container limits '+role)
            if role not in ['postgres','rabbitmq','clamav']:
                require(h['ReadonlyRootfs'] is True and 'ALL' in h['CapDrop'], 'Read-only/cap-drop '+role)
            expected_ports = {'80/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(PORT)}]} if role == 'web' else {}
            require((h['PortBindings'] or {}) == expected_ports, 'Unexpected publication '+role)
            if role == 'web':
                require(obj['Config']['User'] == '101:101'
                        and h['Sysctls'].get('net.ipv4.ip_unprivileged_port_start') == '0'
                        and all('uid=101,gid=101,mode=0700' in h['Tmpfs'].get(path,'')
                                for path in ['/var/cache/nginx','/var/run']), 'Nonroot web tmpfs/sysctl')
            if role == 'web':
                # Attach the normal bridge before start so Docker creates the loopback publication.
                # Every backend service stays exclusively on the internal bridge.
                call('web-connect-ingress', ['network', 'connect', ingress, cid])
            call(role+'-start', ['start', cid])
            actual = inspect_own(role, cid, image)
            connections = actual['NetworkSettings']['Networks']
            actual_network_ids = {v['NetworkID'] for v in connections.values()}
            actual_ports = actual['NetworkSettings'].get('Ports') or {}
            if net == 'none':
                require(actual['HostConfig']['NetworkMode'] == 'none'
                        and set(connections).issubset({'none'})
                        and not actual_network_ids.intersection({network, ingress}), 'Offline signature network')
            else:
                expected_network_ids = {network, ingress} if role == 'web' else {network}
                require(len(connections) == len(expected_network_ids)
                        and actual_network_ids == expected_network_ids, 'Actual network membership '+role)
            if role == 'web':
                require(actual_ports == expected_ports, 'Actual loopback web publication')
            else:
                require(not any(actual_ports.values()), 'Actual unexpected publication '+role)
            checks.append({'nativeNetworkProof':role,'containerId':cid,
                           'networkIds':sorted(actual_network_ids),'publishedPorts':actual_ports,
                           'signatureOffline':net == 'none'})
            return cid

        def wait_until(name, probe, seconds):
            stop = min(deadline, time.monotonic()+seconds)
            while True:
                if probe():
                    return
                require(time.monotonic() < stop, name+' readiness timeout')
                time.sleep(min(2, max(0, stop-time.monotonic())))

        def sql(name, query, persist=True, limit=8*1048576):
            require(query.lstrip().upper().startswith('SELECT '), 'Only read-only SQL permitted')
            return json.loads(call(name, ['exec', created['postgres'][0], 'psql', '-X', '-U', 'inspector',
                                         '-d', 'inspector', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query],
                                   cap=30, persist=persist, limit=limit)[1])

        try:
            fixture = json.loads((I/'fixture-input.json').read_bytes())
            if args.full_source_pdf:
                from cpu_full_source_probe import verify_original
                verify_original(args.full_source_pdf)
            expected = json.loads((I/'expected.json').read_bytes())
            identities = json.loads((I/'parameter-identities.json').read_bytes())['items']
            pdf = pinned(fixture['pdf'])
            canonical = json.loads((I/'v13-definitions.json').read_bytes())
            require(sha((I/'v13-definitions.json').read_bytes())==fixture['profile']['configHash'], 'Frozen V13 canonical fixture')
            migrations = {p.name:sha(p.read_bytes()) for p in (R/'migrations').glob('[0-9][0-9][0-9]_*.sql')}
            runtime_pins = [{'path':str(p),'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size}
                for base in ['apps/api/src','services/worker/inspector_worker','services/worker/rules','migrations']
                for p in sorted((R/base).rglob('*')) if p.is_file() and '__pycache__' not in p.parts]
            ready = {'protectedFiles':[{'path':str(p),'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size}
                for p in [*sorted(I.glob('*.json')), R/'scripts/cpu_full_source_probe.py']],
                'runnerSha256':sha(pathlib.Path(__file__).read_bytes())}
            image_receipt = json.loads(args.images_json.read_bytes())
            require(re.fullmatch('[a-f0-9]{40}|[a-f0-9]{64}',image_receipt['revision']), 'Git revision format')
            for row in image_receipt['images']:
                images[row['role']] = row['imageId']
            for role,digest in INFRASTRUCTURE_DIGESTS.items():
                acquisition = image_receipt['infrastructure'][role]
                require(acquisition['originalManifestDigest']=='sha256:'+digest, 'Infrastructure manifest identity '+role)
                images[role] = acquisition['imageId']
            require(set(images)=={'api','worker','web','postgres','rabbitmq','clamav'}, 'Exact image roles')
            require(all(re.fullmatch('sha256:[a-f0-9]{64}',image) for image in images.values()), 'Exact Docker image IDs')
            checks.append({'gitRevision':image_receipt['revision'],'imageReceiptSha256':sha(args.images_json.read_bytes()),
                           'historicalExpectations':'Synthetic fixture and contract expectations; actual durable release independently checked.'})
            for role, image in images.items():
                meta = json.loads(call(role+'-image', ['image', 'inspect', image])[1])[0]
                require(meta['Id'] == image and meta['Os'] == 'linux' and meta['Architecture'] == 'amd64',
                        'Installed image identity '+role)
                if role in {'api','worker','web'}:
                    require(meta['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==image_receipt['revision'], 'Application image revision label '+role)
                allowed_volumes = {'postgres':{'/var/lib/postgresql/data'}, 'rabbitmq':{'/var/lib/rabbitmq'},
                                   'clamav':{'/var/lib/clamav'}}.get(role,set())
                require(set(meta['Config'].get('Volumes') or {}).issubset(allowed_volumes),
                        'Unexpected declared image volume; STOP before resource creation '+role)
            code, data = call('api-installed-policy', ['run','--rm','--network','none','--read-only','--cap-drop','ALL',
                '--memory','768m','--pids-limit','128','--tmpfs','/tmp:rw,nosuid,size=64m',
                '--env','TSX_DISABLE_CACHE=1',images['api'],'node','--import','tsx','--input-type=module','-e',
                "import {matrixFullPolicyForProfile} from './apps/api/src/matrix-concrete-wall-profile-v13.ts';process.stdout.write(JSON.stringify(matrixFullPolicyForProfile('matrix-text-facts-concrete-walls-v13')))"])
            policy = json.loads(data)
            require(policy and policy['definitions']==canonical and policy['configHash']==fixture['profile']['configHash']
                and policy['installedIdentity']==fixture['profile']['installedIdentity'], 'Actual current image installed V13 policy')
            mem = pathlib.Path('/proc/meminfo').read_text()
            available = int(re.search(r'^MemAvailable:\s+(\d+) kB$', mem, re.M).group(1))
            min_available_kib = available if min_available_kib is None else min(min_available_kib, available)
            minimum_kib = 6291456 if args.full_source_pdf else 4194304
            write('resource-gate.json', {'atUtc': utc(), 'MemAvailableKiB': available, 'minimumKiB': minimum_kib})
            if available < minimum_kib:
                resource_red = True
                raise RuntimeError('FIRST_RED_RESOURCE: MemAvailable below admission threshold; no services started')
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', PORT))
            before = snapshot('before')
            for kind in ['container', 'volume', 'network']:
                require(not call('owner-before-'+kind, [kind, 'ls', '-q', '--filter', 'label=inspector.owner='+OWNER])[1].strip(),
                        'Existing owned resources; refuse reuse')
            for role in list(CAPS):
                require(not call('name-before-'+role, ['container', 'ls', '-aq', '--filter', 'name=^/'+OWNER+'-'+role+'$'], persist=False)[1].strip(),
                        'Container name occupied '+role)
            for name in [OWNER, OWNER+'-ingress']:
                require(not call('network-name-before-'+name,['network','ls','-q','--filter','name=^'+name+'$'])[1].strip(),
                        'Network name occupied '+name)
            network_plans.add('backend')
            network = call('network-create', ['network', 'create', '--driver', 'bridge', '--internal',
                                             '--label', 'inspector.owner='+OWNER, OWNER])[1].decode().strip()
            network_meta = json.loads(call('network-inspect',['network','inspect',network])[1])[0]
            require(network_meta['Id'] == network and network_meta['Name'] == OWNER and network_meta['Internal'] is True
                    and network_meta['Driver'] == 'bridge' and network_meta['Labels'].get('inspector.owner') == OWNER,
                    'Owned internal bridge verification')
            network_plans.add('ingress')
            ingress = call('ingress-create', ['network', 'create', '--driver', 'bridge',
                                             '--label', 'inspector.owner='+OWNER, OWNER+'-ingress'])[1].decode().strip()
            ingress_meta = json.loads(call('ingress-inspect',['network','inspect',ingress])[1])[0]
            require(ingress_meta['Id'] == ingress and ingress_meta['Name'] == OWNER+'-ingress'
                    and ingress_meta['Internal'] is False and ingress_meta['Driver'] == 'bridge'
                    and ingress_meta['Labels'].get('inspector.owner') == OWNER and ingress != network,
                    'Owned web-only ingress bridge verification')
            for role in ['postgres', 'rabbitmq', 'clamav', 'storage']:
                name = OWNER+'-'+role
                require(name not in before['volume'], 'Volume name occupied')
                # Record intent first so cleanup can recover a successful create after CLI transport loss.
                volume_names[role] = name
                call('volume-create-'+role, ['volume', 'create', '--label', 'inspector.owner='+OWNER, name])
            pg_password, rabbit_password, token = secrets.token_hex(24), secrets.token_hex(24), secrets.token_hex(32)
            redactions.extend([pg_password, rabbit_password, token])
            pg_env = environment('postgres', {'POSTGRES_DB': 'inspector', 'POSTGRES_USER': 'inspector', 'POSTGRES_PASSWORD': pg_password})
            rabbit_env = environment('rabbitmq', {'RABBITMQ_DEFAULT_USER': 'inspector', 'RABBITMQ_DEFAULT_PASS': rabbit_password})
            rabbit_url = 'amqp://inspector:'+rabbit_password+'@rabbitmq:5672'
            common_env = {'DATABASE_URL': 'postgresql://inspector:'+pg_password+'@postgres:5432/inspector',
                          'INTERNAL_WORKER_TOKEN': token, 'RABBITMQ_URL': rabbit_url,
                          'NODE_OPTIONS': '--max-old-space-size=384', 'TSX_DISABLE_CACHE': '1'}
            api_env = environment('api', dict(common_env, API_PORT='4100', API_HOST='0.0.0.0',
                    NODE_OPTIONS='--max-old-space-size=768' if args.full_source_pdf else common_env['NODE_OPTIONS'],
                    INSPECTOR_ANALYSIS_PROFILE='MATRIX_V1', INSPECTOR_MATRIX_CONCRETE_WALLS_V13='1',
                    INSPECTOR_OPEN_WORKSPACE='1', SESSION_COOKIE_SECURE='0', ALLOWED_ORIGINS=BASE,
                    S3_ENDPOINT='', UPLOAD_STORAGE_DIR='/app/runtime', REFERENCE_DATASET_DIR='/reference-data',
                    CLAMAV_HOST='clamav', CLAMAV_PORT='3310'))
            relay_env = environment('relay', dict(common_env, OUTBOX_METRICS_HOST='0.0.0.0', OUTBOX_METRICS_PORT='9465'))
            mount = lambda role, dst: ['--mount', 'type=volume,src='+volume_names[role]+',dst='+dst]
            # The new named Clam volume receives only bundled image bytes. No downloaded DB/cache is mounted.
            signature_script = ('set -eu; for name in main daily; do file=""; '
                                'for ext in cvd cld; do p="/var/lib/clamav/$name.$ext"; '
                                'if [ -s "$p" ]; then file="$p"; break; fi; done; '
                                '[ -n "$file" ] || { echo "MISSING_BUNDLED_CLAM_DATABASE:$name" >&2; exit 42; }; '
                                'sigtool --info "$file"; done')
            sig = create('signatures', images['clamav'], ['--read-only', '--cap-drop', 'ALL', '--entrypoint', '/bin/sh']
                         + ['--mount', 'type=volume,src='+volume_names['clamav']+',dst=/var/lib/clamav,readonly'],
                         ['-c', signature_script], net='none')
            exitcode = call('signatures-wait', ['wait', sig], cap=60)[1].decode().strip()
            signatures = call('signatures-log', ['logs', sig])[1].decode()
            require(exitcode == '0' and signatures.count('Verification OK') >= 2,
                    'Bundled Clam main/daily DB missing or unverifiable; STOP before upload')
            pgid = create('postgres', images['postgres'], ['--env-file', pg_env]
                          + mount('postgres', '/var/lib/postgresql/data'))
            wait_until('postgres', lambda: call('pg-ready-'+str(len(records)), ['exec', pgid, 'pg_isready', '-U', 'inspector', '-d', 'inspector'],
                                               check=False, persist=False)[0] == 0, 180)
            app_options = ['--read-only', '--cap-drop', 'ALL', '--tmpfs', '/tmp:rw,nosuid,size=64m']
            migrate = create('migrate', images['api'], app_options+['--env-file', api_env],
                             ['npm', 'run', 'db:migrate', '-w', '@inspector-ai/api'])
            require(call('migration-wait', ['wait', migrate], cap=120)[1].decode().strip() == '0', 'Migration failure')
            call('migration-log', ['logs', migrate])
            require(sql('migration-whole', "SELECT coalesce(json_object_agg(name,trim(checksum)),'{}'::json) FROM schema_migrations") == migrations,
                    'Complete committed migration inventory differs from the applied database')
            rabbit = create('rabbitmq', images['rabbitmq'], ['--env-file', rabbit_env, '--hostname', OWNER+'-rabbitmq']
                            + mount('rabbitmq', '/var/lib/rabbitmq'))
            wait_until('rabbitmq', lambda: call('rabbit-ready-'+str(len(records)), ['exec', '--user', 'rabbitmq', rabbit, 'rabbitmq-diagnostics', '-q', 'ping'],
                                               check=False, persist=False)[0] == 0, 120)
            create('clamav', images['clamav'], ['--env', 'CLAMD_CONF_StreamMaxLength=128M', '--env', 'CLAMD_CONF_MaxFileSize=128M',
                   '--env', 'CLAMD_CONF_MaxScanSize=250M']+mount('clamav', '/var/lib/clamav'))
            reference_options = []
            reference_root = R/'datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data'
            refs = {'parameter_catalog_132.jsonl': 'c6b73dffbea6bb366fc50f08392522c390bdf7b19420051802bd0bcbd32b4e4f',
                    'public_train_checks.jsonl': 'f992db4b339fa2d5a49176e65693fd38be3b6cbffc5a6838ca9819050db32658',
                    'document_manifest.jsonl': '853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7'}
            for name, digest in refs.items():
                require(sha((reference_root/name).read_bytes()) == digest, 'Public reference changed')
                reference_options += ['--mount', 'type=bind,src='+str(reference_root/name)+',dst=/reference-data/data/'+name+',readonly']
            api = create('api', images['api'], app_options+['--env-file', api_env]+reference_options
                         + ['--mount', 'type=volume,src='+volume_names['storage']+',dst=/app/runtime,volume-nocopy=true'])
            create('web', images['web'], ['--read-only', '--cap-drop', 'ALL', '--user', '101:101',
                   '--sysctl', 'net.ipv4.ip_unprivileged_port_start=0',
                   '--tmpfs', '/var/cache/nginx:rw,nosuid,size=16m,uid=101,gid=101,mode=0700',
                   '--tmpfs', '/var/run:rw,nosuid,size=4m,uid=101,gid=101,mode=0700',
                   '--publish', '127.0.0.1:'+str(PORT)+':80', '--entrypoint', 'nginx'],
                   ['-g', 'daemon off;'], cpu=0.5)
            jar = http.cookiejar.CookieJar()
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, *args):
                    return None
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar), NoRedirect())

            def request_http(name, path, method='GET', body=None, headers=None, status=200, persist=True,
                             max_bytes=8*1048576, timeout=55):
                # Empty POST must not trigger urllib's form Content-Type; retain explicit method.
                if body == b'':
                    body = None
                request = urllib.request.Request(BASE+path, data=body, method=method, headers=headers or {})
                try:
                    response = opener.open(request, timeout=remaining(timeout))
                except urllib.error.HTTPError as e:
                    response = e
                with response:
                    data = response.read(max_bytes+1)
                    response_status, response_headers = response.status, list(response.headers.items())
                require(len(data) <= max_bytes, 'HTTP output bound '+name)
                # Register every Set-Cookie before persisting body or formatting a status error.
                # CookieJar can reject a malformed or out-of-scope cookie; its echoed value is still private.
                for key,value in response_headers:
                    if key.lower() == 'set-cookie':
                        candidates = [value, value.split(';',1)[0].partition('=')[2].strip()]
                        try:
                            parsed = http.cookies.SimpleCookie()
                            parsed.load(value)
                            candidates.extend(m.value for m in parsed.values())
                        except (http.cookies.CookieError, ValueError):
                            pass
                        redactions.extend(v for v in candidates if v and v not in redactions)
                for cookie in jar:
                    if cookie.value and cookie.value not in redactions:
                        redactions.append(cookie.value)
                if persist:
                    stored = clean(data)
                    write(name+'-body.bin', data, True)
                    write(name+'-headers.json', [(k, '<REDACTED>' if k.lower() == 'set-cookie' else v) for k,v in response_headers])
                    checks.append({'http': name, 'method': method, 'path': path, 'status': response_status,
                                   'bytes': len(data), 'sha256': sha(data), 'wireSha256':sha(data),
                                   'storedBytes':len(stored),'storedSha256':sha(stored),'redacted':stored != data})
                require(response_status == status, name+' HTTP '+str(response_status)+' '+data[:250].decode(errors='replace'))
                return data, {k.lower(): v for k,v in response_headers}

            def api_ready():
                try:
                    return json.loads(request_http('api-ready', '/api/health', persist=False)[0]) == {'status':'ok','service':'inspector-ai-api'}
                except (urllib.error.URLError, TimeoutError, ConnectionError, AssertionError):
                    return False
            wait_until('API', api_ready, 120)
            # Actual TCP daemon protocol, from the same network as API. No scanner replacement.
            clam_probe = "const n=require('node:net');let b='';const s=n.connect(3310,'clamav',()=>s.write('z'+process.argv[1]+'\\0'));s.setTimeout(3000,()=>{s.destroy();process.exitCode=2});s.on('data',d=>{b+=d.toString();if(b.includes('\\0')){process.stdout.write(b);s.end()}});s.on('error',()=>{process.exitCode=3});"
            wait_until('ClamAV', lambda: call('clam-ping-'+str(len(records)), ['exec', api, 'node', '-e', clam_probe, 'PING'],
                                             check=False, persist=False, cap=5)[1].strip(b'\x00\r\n ') == b'PONG', 240)
            version = call('clam-version', ['exec', api, 'node', '-e', clam_probe, 'VERSION'], cap=5)[1]
            require(re.match(rb'ClamAV [^/\x00]+/[1-9][0-9]*/', version), 'No loaded real Clam database version')
            relay = create('relay', images['api'], app_options+['--env-file', relay_env], ['npm', 'run', 'outbox:relay', '-w', '@inspector-ai/api'])
            relay_probe = "fetch('http://127.0.0.1:9465/health').then(async r=>{if(r.status!==200)process.exitCode=1;process.stdout.write(await r.text())}).catch(()=>process.exitCode=2)"
            wait_until('relay', lambda: call('relay-ready-'+str(len(records)), ['exec', relay, 'node', '-e', relay_probe],
                                            check=False, persist=False, cap=5)[0] == 0, 90)
            for role, queue in QUEUES.items():
                worker_env = environment(role, {'RABBITMQ_URL': rabbit_url, 'INSPECTOR_API_INTERNAL_URL': 'http://api:4100/api/internal/v1',
                      'INTERNAL_WORKER_TOKEN': token, 'WORKER_ID': OWNER+'-'+role, 'WORKER_HEARTBEAT_SECONDS': '20',
                      'REFERENCE_DATASET_DIR': '/reference-data', 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUNBUFFERED': '1'})
                create(role, images['worker'], app_options+['--env-file', worker_env]+reference_options,
                       ['inspector-worker', '--queue', queue])
            def queues_ready():
                code, data = call('queues-ready-'+str(len(records)), ['exec', rabbit, 'rabbitmqctl', 'list_queues', '--quiet',
                                   'name', 'messages_ready', 'messages_unacknowledged', 'consumers', '--formatter', 'json'],
                                   check=False, persist=False)
                if code != 0:
                    return False
                try:
                    rows = json.loads(data)
                    return all(sum(q['consumers'] for q in rows if q['name'] == queue) == 1 for queue in QUEUES.values())
                except (ValueError, KeyError, TypeError):
                    return False
            wait_until('four queue consumers', queues_ready, 90)
            call('broker-consumers-before', ['exec', rabbit, 'rabbitmqctl', 'list_queues', '--quiet', 'name', 'messages_ready',
                  'messages_unacknowledged', 'consumers', '--formatter', 'json'])
            call('docker-stats-ready', ['stats','--no-stream','--format','{{json .}}']
                 +[cid for role,(cid,_) in created.items() if role not in ['migrate','signatures']], cap=15)
            write('startup-boundary.json', {'atUtc': utc(), 'wallSeconds': round(time.monotonic()-started,3),
                  'clamBundledMainDailyVerified': True, 'clamDaemonVersion': version.decode().strip('\x00\r\n '),
                  'fourRealConsumers': True, 'images': images, 'uploaded': False,
                  'backendInternalNetworkId':network, 'webOnlyIngressNetworkId':ingress,
                  'ingressEgressCapable':True, 'externalProvidersCalled':False})
            require(time.monotonic() <= started+900, 'Startup900 exceeded')
            phase, deadline = 'normalRun', time.monotonic()+600
            parameters = json.loads(request_http('parameters', '/api/parameters')[0])['items']
            identity3 = [{k:p[k] for k in ['parameterId','parameterCode','parameterName']} for p in identities]
            projection = lambda p: {'parameterId': p['parameter_id'], 'parameterCode': p['parameter_code'],
                                    'parameterName': p['parameter_name']}
            require(sorted(map(projection, parameters), key=lambda p:p['parameterId']) == identity3, '132 parameter identities')
            actor = json.loads(request_http('open-workspace', '/api/auth/open-workspace', 'POST', b'', {'Origin': BASE})[0])
            require(actor['user']['roles'] == ['SUPERVISOR'] and 'OBJECT_CREATE' in actor['user']['capabilities'], 'Real session actor')
            cookies = {c.name:c.value for c in jar}
            require(set(cookies) == {'inspector_session','inspector_csrf'} and all(cookies.values()), 'Session cookies')
            require(any(c.name == 'inspector_session' and 'HttpOnly' in c._rest for c in jar), 'Session HttpOnly cookie')
            csrf = {'Origin': BASE, 'X-CSRF-Token': cookies['inspector_csrf']}
            def post(name, path, body, content_type='application/json', **http_options):
                headers = dict(csrf, **{'Content-Type': content_type, 'Idempotency-Key': OWNER+'-'+name+'-'+secrets.token_hex(8)})
                return json.loads(request_http(name, path, 'POST', body, headers, status=201, **http_options)[0])
            obj = post('object', '/api/objects', json.dumps(fixture['objectBody'], ensure_ascii=False).encode())
            object_id = obj['id']
            require(re.fullmatch('[A-Za-z0-9-]{1,100}', object_id), 'Object ID')
            boundary = 'inspector-cpu-'+secrets.token_hex(20)
            body = ('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="pd-both.pdf"\r\nContent-Type: application/pdf\r\n\r\n').encode()+pdf+('\r\n--'+boundary+'--\r\n').encode()
            upload = post('upload', '/api/objects/'+object_id+'/files?stage=PD', body, 'multipart/form-data; boundary='+boundary)
            require(upload['objectId'] == object_id and upload['status'] == 'ACCEPTED' and len(upload['files']) == 1, 'Upload association')
            file = upload['files'][0]
            require({k:file[k] for k in ['name','sha256','size','stage','mimeType','scanStatus','status']} ==
                    {'name':'pd-both.pdf','sha256':fixture['pdf']['sha256'],'size':40536,'stage':'PD','mimeType':'application/pdf','scanStatus':'CLEAN','status':'STORED'}, 'Genuine CLEAN original upload')
            source_id = file['id']
            require(re.fullmatch('[A-Za-z0-9-]{1,100}', source_id), 'Source ID')
            source_path = '/api/objects/'+object_id+'/files'
            sources = json.loads(request_http('sources', source_path)[0])['items']
            require(len(sources) == 1, 'Exactly one source')
            src = sources[0]
            require(src['id'] == source_id and src['sha256'] == fixture['pdf']['sha256'] and src['size'] == 40536
                    and src['name'] == 'pd-both.pdf' and src['stages'] == ['PD'] and src['review'] is None
                    and src['pageCount'] in [None,2], 'Unreviewed PD source identity')
            original, headers = request_http('source-content', source_path+'/'+source_id+'/content')
            require(original == pdf and headers.get('x-content-sha256') == fixture['pdf']['sha256'], 'Original whole PDF read')
            page_png,page_headers = request_http('source-page-preview', source_path+'/'+source_id+'/pages/2/preview?resolution=1200')
            require(page_png.startswith(b'\x89PNG\r\n\x1a\n') and page_headers.get('content-type','').startswith('image/png'), 'Actual source page PNG render')
            check = post('start', '/api/objects/'+object_id+'/checks', json.dumps(fixture['startBody']).encode())
            check_id = check['id']
            require(re.fullmatch('[A-Za-z0-9-]{1,100}', check_id) and check['objectId'] == object_id and check['mode'] == 'NORMAL', 'NORMAL check identity')
            check_path = '/api/checks/'+check_id
            where = "run.api_id='"+check_id+"'"
            poll_query = "SELECT coalesce(json_agg(json_build_object('type',job.job_type,'state',job.state,'attempt',job.attempt_count)),'[]'::json) FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id WHERE "+where
            while True:
                rows = sql('poll-'+str(len(records)), poll_query, persist=False)
                require(rows and not any(j['type'] == 'DOCUMENT_OCR_LAYOUT' for j in rows), 'Unexpected OCR branch in the text-only synthetic fixture')
                require(not any(j['state'] in ['FAILED','DEAD','CANCELLED','RETRY_WAIT'] or j['attempt'] > 1 for j in rows), 'Job failure/retry: STOP')
                text = sql('text-probe-'+str(len(records)), "SELECT coalesce(job.result_json,'null'::jsonb) FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id WHERE "+where+" AND job.job_type='DOCUMENT_TEXT_LAYER'", persist=False)
                if text is not None:
                    require(text['sourceCount'] == text['extractedCount'] == 1 and text['ocrRequiredPageCount'] == 0
                            and text['sources'][0]['qualitySummary'] == {'textLayerCandidatePageCount':2,'ocrRequiredPageCount':0},
                            'Unexpected extra work in the text-only synthetic fixture')
                current = json.loads(request_http('check-poll', check_path, persist=False)[0])
                require(current['status'] != 'FAILED', 'Check failed')
                if all(j['state'] == 'SUCCEEDED' for j in rows) and current['status'] == 'PARTIAL':
                    break
                remaining(1)
                time.sleep(min(3, remaining(3)))
            terminal = json.loads(request_http('sealed-check', check_path)[0])
            require(terminal['status'] == 'PARTIAL' and terminal['progress'] == 100 and terminal['mode'] == 'NORMAL'
                    and terminal['objectId'] == object_id and terminal['completedAt'], 'Terminal PARTIAL NORMAL')
            def confirmed_dispatch():
                counts = sql('dispatch-probe-'+str(len(records)), "SELECT json_build_object('total',count(*),'published',count(*) FILTER(WHERE o.state='PUBLISHED')) FROM domain_outbox o WHERE o.event_type='job.ready' AND o.exchange_name='inspector.jobs' AND o.payload->>'job_id' IN (SELECT job.id::text FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id WHERE "+where+")", persist=False)
                return counts == {'total':9,'published':9}
            wait_until('confirmed nine dispatches', confirmed_dispatch, 15)
            # Read only the one newly created run, with durable native lease/outbox/result associations.
            proof_query = """SELECT json_build_object(
              'run',to_jsonb(run),'release',to_jsonb(rel),'manifest',to_jsonb(manifest),
              'objectIdentity',(SELECT jsonb_build_object('id',o.id,'apiId',o.api_id) FROM objects o WHERE o.id=run.object_id),
              'jobs',(SELECT json_agg(to_jsonb(j) ORDER BY j.created_at,j.id) FROM analysis_jobs j WHERE j.run_id=run.id),
              'attempts',(SELECT json_agg(to_jsonb(a) ORDER BY a.started_at,a.id) FROM job_attempts a JOIN analysis_jobs j ON j.id=a.job_id WHERE j.run_id=run.id),
              'outbox',(SELECT json_agg(to_jsonb(o) ORDER BY o.created_at,o.id) FROM domain_outbox o WHERE o.event_type='job.ready' AND o.exchange_name='inspector.jobs' AND o.payload->>'job_id' IN (SELECT j.id::text FROM analysis_jobs j WHERE j.run_id=run.id)),
              'dependencies',(SELECT json_agg(to_jsonb(d)) FROM analysis_job_dependencies d WHERE d.run_id=run.id),
              'stages',(SELECT json_agg(jsonb_build_object('id',s.id,'jobId',s.job_id,'jobType',s.job_type,'hash',trim(s.content_hash),'manifest',trim(s.input_manifest_hash),'schema',s.schema_version,'disposition',s.disposition,'providerKind',s.provider_kind,'providerProfileId',s.provider_profile_id,'providerConfigHash',trim(s.provider_config_hash))) FROM analysis_stage_artifacts s WHERE s.run_id=run.id),
              'textArtifacts',(SELECT json_agg(to_jsonb(t)) FROM analysis_text_artifacts t WHERE t.run_id=run.id),
              'snapshot',(SELECT jsonb_build_object('executionHash',trim(p.execution_hash),'submissionHash',trim(p.submission_hash),'submissionBytes',octet_length(p.submission_bytes),'storedSubmissionHash',encode(digest(p.submission_bytes,'sha256'),'hex'),'metadata',p.metadata) FROM machine_prediction_snapshots p WHERE p.run_id=run.id))
              FROM analysis_runs run JOIN analysis_releases rel ON rel.release_id=run.release_id
              JOIN input_manifests manifest ON manifest.id=run.manifest_id WHERE """+where
            proof = sql('whole-native-proof', proof_query, limit=16*1048576)
            write('native-proof.json', proof)
            object_identity = proof['objectIdentity']
            require(set(object_identity) == {'id','apiId'} and object_identity['apiId'] == object_id
                    and object_identity['id'] == proof['run']['object_id'] and proof['run']['api_id'] == check_id
                    and re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', object_identity['id']),
                    'Independent API object to native run UUID association')
            jobs = proof['jobs']
            dag = expected['normalQueue']['baseDag']
            require(len(jobs) == len(proof['attempts']) == len(proof['outbox']) == 9, 'Nine native jobs/attempts/outbox')
            by_type = {j['job_type']:j for j in jobs}
            require(set(by_type) == {j['jobType'] for j in dag}, 'Exact nine job types')
            require(len({j['id'] for j in jobs}) == len({a['id'] for a in proof['attempts']}) == 9, 'Unique durable IDs')
            manifest_hash = proof['manifest']['sha256'].strip()
            for item in dag:
                j = by_type[item['jobType']]
                require(j['queue_name'] == item['queue'] and j['state'] == 'SUCCEEDED' and j['attempt_count'] == 1
                        and j['input_manifest_hash'].strip() == manifest_hash and j['release_id'] == proof['run']['release_id']
                        and j['run_id'] == proof['run']['id'] and j['object_id'] == proof['run']['object_id']
                        and j['inspection_id'] == proof['run']['inspection_id']
                        and j['fencing_token'] == 1 and j['completed_at'], 'Job association '+item['jobType'])
                attempts = [a for a in proof['attempts'] if a['job_id'] == j['id']]
                role = next(k for k,v in QUEUES.items() if v == item['queue'])
                require(len(attempts) == 1 and attempts[0]['state'] == 'SUCCEEDED' and attempts[0]['attempt_number'] == 1
                        and attempts[0]['fencing_token'] == j['fencing_token'] and attempts[0]['worker_id'] == OWNER+'-'+role
                        and attempts[0]['completed_at'] and attempts[0]['id'] == j['current_attempt_id']
                        and attempts[0]['result_json'] == j['result_json'], 'Real matching worker lease '+item['jobType'])
                dispatched = [o for o in proof['outbox'] if o['payload'].get('job_id') == j['id']]
                require(len(dispatched) == 1 and dispatched[0]['state'] == 'PUBLISHED' and dispatched[0]['published_at']
                        and dispatched[0]['routing_key'] == item['queue'] and dispatched[0]['attempt_count'] == 1,
                        'Real confirmed outbox dispatch '+item['jobType'])
                payload = dispatched[0]['payload']
                require(payload['job_type'] == item['jobType'] and payload['run_id'] == j['run_id']
                        and payload['object_id'] == j['object_id'] and payload['inspection_id'] == j['inspection_id']
                        and payload['input_manifest_hash'] == manifest_hash and payload['release_id'] == j['release_id']
                        and payload['semantic_key'] == j['semantic_key'].strip(), 'Whole queue payload association '+item['jobType'])
            deps = {(d['job_id'],d['prerequisite_job_id']) for d in proof['dependencies']}
            require(deps == {(by_type[dag[n]['jobType']]['id'],by_type[dag[n-1]['jobType']]['id']) for n in range(1,9)}, 'Exact chain dependencies8')
            inventory = by_type['ANALYSIS_INVENTORY']['result_json']
            require(inventory['disposition'] == 'MANIFEST_INVENTORIED' and inventory['sourceCount'] == 1
                    and inventory['stageCounts'] == {'PD':1,'RD':0,'ID':0}, 'Inventory subset')
            text = by_type['DOCUMENT_TEXT_LAYER']['result_json']
            require(text['disposition'] == 'DOCUMENT_TEXT_LAYER_COMPLETED' and len(text['sources']) == 1, 'Fresh text subset')
            source = text['sources'][0]
            require(len(proof['textArtifacts']) == 1, 'Exactly one fresh durable text artifact')
            text_artifact = proof['textArtifacts'][0]
            a = text_artifact['content_json']
            require(source['status'] == 'EXTRACTED' and source['inputSha256'] == fixture['pdf']['sha256']
                    and source['artifactId'] == text_artifact['id'] and source['contentHash'] == text_artifact['content_hash'].strip()
                    and text_artifact['job_id'] == by_type['DOCUMENT_TEXT_LAYER']['id']
                    and a['sourceFileId'] == source_id and a['inputSha256'] == fixture['pdf']['sha256']
                    and a['schemaVersion'] == 'document-text-v2' and a['qualityPolicyVersion'] == 'text-layer-quality-v2'
                    and a['pageCount'] == 2 and a['coordinateSystem'] == 'PDF_BOTTOM_LEFT_MILLI_POINTS'
                    and a['qualitySummary'] == {'textLayerCandidatePageCount':2,'ocrRequiredPageCount':0}
                    and len(a['pages']) == 2 and all(p['quality']['disposition'] == 'TEXT_LAYER_CANDIDATE' for p in a['pages']), 'Fresh two-page quality')
            rule = by_type['RULE_EVALUATION']['result_json']
            require(rule['schemaVersion'] == 'analysis-stage-result-v2' and rule['disposition'] == 'RULES_EVALUATED'
                    and re.fullmatch('[0-9a-f]{64}',rule['contentHash']), 'Rule stored summary')
            stages = {s['jobType']:s for s in proof['stages']}
            require(set(stages) == {d['jobType'] for d in dag[2:8]}, 'Six native scaffold stage artifacts')
            for kind,s in stages.items():
                require(s['jobId'] == by_type[kind]['id'] and s['manifest'] == manifest_hash
                        and re.fullmatch('[0-9a-f]{64}',s['hash']), 'Stage lease/input association '+kind)
            rule_stage = stages['RULE_EVALUATION']
            require(rule_stage['schema'] == 'analysis-stage-result-v2' and rule_stage['disposition'] == 'RULES_EVALUATED'
                    and rule_stage['providerKind'] == 'RULE_ENGINE' and rule_stage['providerProfileId'] == fixture['profile']['profileId']
                    and rule_stage['providerConfigHash'] == fixture['profile']['configHash']
                    and rule_stage['hash'] == rule['contentHash'], 'Current rule profile/config')
            release = proof['release']
            require(release['external_network_allowed'] is False, 'External network forbidden')
            # Preflight loaded the policy from the exact API image with networking disabled.
            # The run must bind that profile/config in its immutable release as well as the stage artifact.
            slots = release['content_json']['providerSlots']
            require(any(s.get('profileId') == fixture['profile']['profileId'] and s.get('configHash') == fixture['profile']['configHash']
                        and s.get('stageJobType') == 'RULE_EVALUATION' for s in slots), 'Immutable release current provider')
            require(release['content_json']['rules']['matrixDefinitions'] == canonical
                    and canonical['concreteWallExecution']['sourcePins'] == fixture['profile']['sourcePins8'], 'Whole immutable canonical definitions/sourcePins8')
            coverage_body, _ = request_http('coverage', check_path+'/coverage')
            coverage = json.loads(coverage_body)['items']
            def coverage_identity(p):
                return {k:p[k] for k in ['parameterId','parameterCode','parameterName']}
            require(sorted(map(coverage_identity,coverage),key=lambda p:p['parameterId']) == identity3, '132 exact coverage identities')
            for p in coverage:
                require(p['executionStatus'] in expected['coverageShape']['executionStatusEnum'], 'Coverage status enum')
                if 'atomic' in p:
                    require(p['atomic']['executionStatus'] in expected['coverageShape']['atomicStatusEnum'], 'Atomic status')
                    for field in expected['coverageShape']['atomicNonnegativeIntegerFields']:
                        value = p['atomic'][field]
                        require(type(value) is int and value >= 0, 'Atomic nonnegative integer '+field)
            matrix_body, matrix_headers = request_http('matrix', check_path+'/matrix-execution')
            matrix = json.loads(matrix_body)
            execution = matrix['execution']
            require(matrix['checkId'] == check_id and matrix_headers.get('etag') == '"'+matrix['contentHash']+'"'
                    and execution['objectId'] == proof['run']['object_id'] and execution['inputManifestHash'] == manifest_hash, 'Saved matrix association')
            codes = {p['parameterCode'] for p in identities}
            for rows in [execution['coverage'],matrix['effectiveCoverage']]:
                require(len(rows) == 132 and {p['parameterCode'] for p in rows} == codes, 'Coverage code set132')
                require(sum(p['successfulComparisons'] for p in rows) == 0, 'No qualified single-PD successful comparisons')
            presentations = matrix['presentation']
            require(len(presentations) == len(execution['results']) and [p['resultIndex'] for p in presentations] == list(range(len(presentations))), 'Presentation result indices')
            for p,r in zip(presentations,execution['results']):
                require(p['confidence'] == expected['confidenceShape']['confidenceEnvelope'] and p['policyVersion'] == 'machine-confidence-policy-v2'
                        and p['warningThreshold'] == 0.8, 'No calibrated probability promotion')
                failed = r['executionStatus'] == 'FAILED'
                require(p['machineDisposition'] == ('TECHNICAL_FAILURE' if failed else 'CANDIDATE')
                        and p['reasonCode'] == ('TECHNICAL_FAILURE' if failed else 'CONFIDENCE_NOT_ESTIMABLE'), 'Confidence candidate/failure only')
                if r.get('comparisonVariant') in ['PD_RD','PD_ID','RD_ID']:
                    require(r['qualified'] is False and r.get('violation') is not True
                            and r.get('machineStatus') not in ['VIOLATION','NEGATIVE_VERIFIED'], 'No cross-stage verified violation')
            for name,value in matrix.items():
                if isinstance(value,dict) and isinstance(value.get('results'),list) and name.endswith('Comparisons'):
                    for result in value['results']:
                        require(result.get('comparison',{}).get('status') != 'CANDIDATE', 'Unreviewed pair cannot be qualified')
            findings = json.loads(request_http('findings', check_path+'/findings')[0])['items']
            for f in findings:
                require(f['checkId'] == check_id and f['decision'] is None, 'No human finding decision')
                require(set(expected['findingShape']['fields']).issubset(f), 'Finding typed fields')
                for evidence in f['evidence']:
                    require(evidence['stage'] == 'PD' and evidence['pdfPageNumber'] in [1,2]
                            and evidence['fileId'] == source_id and evidence['sha256'] == fixture['pdf']['sha256'], 'Only original PD page evidence')
            submission_body, sub_headers = request_http('submission', check_path+'/submission')
            submission = json.loads(submission_body)
            require(matrix['submission']['partial'] is True and matrix['submission']['officialIdsVerified'] is False
                    and matrix['submission']['mappingVersion'] == expected['submissionShape']['mappingVersion']
                    and submission['object_id'] == object_id, 'Diagnostic application identity only')
            require(sha(submission_body) == matrix['submission']['contentHash'] == sub_headers.get('x-content-sha256')
                    == proof['snapshot']['submissionHash'] == proof['snapshot']['storedSubmissionHash']
                    and len(submission_body) == proof['snapshot']['submissionBytes']
                    and matrix['contentHash'] == proof['snapshot']['executionHash'], 'Stored whole submission/stage integrity')
            review_path = source_path+'/'+source_id+'/source-review'
            request_http('review-absent-before',review_path,status=404)
            first_review_body = {'sourceSha256':fixture['pdf']['sha256'],'revisionStatus':'UNKNOWN','approvalStatus':'UNKNOWN',
                'linkGroupId':None,'pageStages':{},'basis':{'reference':'Synthetic CPU smoke: authority and revision remain unknown.'},'expectedReviewHash':None}
            first_review = post('review-first',review_path,json.dumps(first_review_body).encode())
            second_review_body = {**first_review_body,'expectedReviewHash':first_review['contentHash'],
                'basis':{'reference':'Synthetic CPU smoke second review: authority and revision still unknown.'}}
            second_review = post('review-second',review_path,json.dumps(second_review_body).encode())
            require(first_review['id']!=second_review['id'] and first_review['contentHash']!=second_review['contentHash'], 'Distinct append-only review decisions')
            review_saved = request_http('review-latest',review_path)[0]
            require(json.loads(review_saved)==second_review, 'Latest source decision stored')
            history = sql('source-review-native-history', "SELECT json_agg(json_build_object('id',review.id,'hash',trim(review.content_hash),'basis',review.basis_reference) ORDER BY review.created_at,review.id) FROM source_review_decisions review JOIN source_files source ON source.id=review.source_file_id WHERE source.api_id='"+source_id+"'")
            require(len(history)==2 and {row['id'] for row in history}=={first_review['id'],second_review['id']}
                and {row['hash'] for row in history}=={first_review['contentHash'],second_review['contentHash']}, 'Append-only native history keeps both reviews')
            check_history = json.loads(request_http('check-history','/api/objects/'+object_id+'/checks')[0])['items']
            require(len(check_history)==1 and check_history[0]['id']==check_id, 'Current run visible in object history')
            checks.append({'sourceReviewHistoryCount':2,'authorityClaimed':False,'engineeringDecisionCreated':False})
            for name,path,first in [('matrix',check_path+'/matrix-execution',matrix_body),('coverage',check_path+'/coverage',coverage_body),('submission',check_path+'/submission',submission_body)]:
                require(request_http(name+'-repeat',path)[0] == first, 'Whole repeated saved-read consistency '+name)
            call('restart-postgres', ['restart', created['postgres'][0]], cap=45)
            wait_until('postgres restart', lambda: call('pg-restarted-'+str(len(records)), ['exec', created['postgres'][0], 'pg_isready', '-U', 'inspector', '-d', 'inspector'], check=False, persist=False)[0] == 0, 60)
            call('restart-runtime', ['restart',api,created['relay'][0]]+[created[role][0] for role in QUEUES], cap=90)
            wait_until('API restart', api_ready, 120)
            for name,path,first in [('matrix',check_path+'/matrix-execution',matrix_body),('coverage',check_path+'/coverage',coverage_body),('submission',check_path+'/submission',submission_body),('check',check_path,json.dumps(terminal).encode())]:
                after = request_http(name+'-after-restart', path)[0]
                require(json.loads(after)==terminal if name=='check' else after==first, 'Saved read after process/database restart '+name)
            require(request_http('review-after-restart',review_path)[0]==review_saved, 'Latest decision preserved across restart')
            wait_until('workers restart', queues_ready, 60)
            checks.append({'restartReadProof':True,'restarted':['postgres','api','relay',*QUEUES],'matrixCoverageSubmissionByteExact':True,'checkSemanticExact':True})
            require(queues_ready(), 'Four consumers still present')
            def drained():
                data = call('broker-drain-'+str(len(records)), ['exec',rabbit,'rabbitmqctl','list_queues','--quiet','name','messages_ready','messages_unacknowledged','consumers','--formatter','json'], persist=False)[1]
                rows = json.loads(data)
                return all(q['messages_ready'] == q['messages_unacknowledged'] == 0 for q in rows if q['name'] in QUEUES.values())
            wait_until('broker acknowledgements/drain', drained, 15)
            broker = json.loads(call('broker-after', ['exec',rabbit,'rabbitmqctl','list_queues','--quiet','name','messages_ready','messages_unacknowledged','consumers','--formatter','json'])[1])
            require(all(q['messages_ready'] == q['messages_unacknowledged'] == 0 for q in broker if q['name'] in QUEUES.values()), 'Queue ack/drain incomplete')
            api_logs = call('api-protocol-log', ['logs',api], limit=8*1048576)[1]
            incoming, completed = {}, {}
            for line in api_logs.splitlines():
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if isinstance(row.get('req'),dict) and row['req'].get('url'):
                    incoming[row.get('reqId')] = row['req']['url']
                if isinstance(row.get('res'),dict) and 'statusCode' in row['res']:
                    completed[row.get('reqId')] = row['res']['statusCode']
            accepted = {url for rid,url in incoming.items() if completed.get(rid) == 200}
            for kind,job in by_type.items():
                prefix = '/api/internal/v1/jobs/'+job['id']+'/'
                require(prefix+'claim' in accepted and any(prefix+suffix in accepted for suffix in
                        ['complete','complete-concrete-wall-v13','complete-column-pylon-section-v12']), 'Real API claim/complete '+kind)
            for kind in ['RULE_EVALUATION','ANALYSIS_SEAL_UNSUPPORTED']:
                require('/api/internal/v1/jobs/'+by_type[kind]['id']+'/heartbeat' in accepted, 'Real final lease heartbeat '+kind)
            if args.full_source_pdf:
                phase, deadline = 'fullSourceRun', time.monotonic()+900
                from cpu_full_source_probe import run_full_source_probe
                run_full_source_probe(original=args.full_source_pdf, owner=OWNER, images=images,
                    created=created, http=request_http, post=post, sql=sql, call=call,
                    write=write, checks=checks, remaining=remaining, api_ready=api_ready,
                    wait_until=wait_until)
            request_http('logout','/api/auth/logout','POST',b'',csrf)
            request_http('session-revoked','/api/auth/session',status=401)
            checks.append({'normalJobs':9,'realSuccessfulAttempts':9,'confirmedOutbox':9,'identities':132,
                           'wholeRepeatReadConsistencyOnly':True,'unknownSemanticTotalsStillNotGoldens':True})
            success = True
        except BaseException as exc:
            error = clean((type(exc).__name__+': '+str(exc)).encode()).decode(errors='replace')
        finally:
            phase, deadline = 'cleanup', time.monotonic()+180
            if created:
                try:
                    call('docker-stats-before-cleanup',['stats','--no-stream','--format','{{json .}}']
                         +[cid for role,(cid,_) in created.items() if role not in ['migrate','signatures']], cap=15)
                except BaseException as exc:
                    cleanup.append({'kind':'statsBeforeCleanup','error':str(exc)})
            # Recover IDs only by exact predeclared name/image/label, never by a broad removal filter.
            for role,image in planned.items():
                if role not in created:
                    try:
                        code,data = call('recover-'+role,['inspect',OWNER+'-'+role],check=False)
                        if code == 0:
                            obj = json.loads(data)[0]
                            inspect_own(role,obj['Id'],image)
                            created[role] = (obj['Id'],image)
                    except BaseException as exc:
                        cleanup.append({'role':role,'recoveryError':str(exc)})
            for role,(cid,image) in reversed(list(created.items())):
                try:
                    inspect_own(role,cid,image)
                    call('cleanup-log-'+role,['logs','--tail','200',cid],check=False,cap=8)
                    call('cleanup-remove-'+role,['rm','--force',cid],cap=12)
                    cleanup.append({'kind':'container','role':role,'id':cid,'removed':True})
                except BaseException as exc:
                    cleanup.append({'kind':'container','role':role,'error':str(exc)})
            for role,name in reversed(list(volume_names.items())):
                try:
                    code,data = call('cleanup-volume-inspect-'+role,['volume','inspect',name],check=False,cap=5)
                    if code == 0:
                        obj = json.loads(data)[0]
                        require(obj['Name'] == name and obj['Labels'].get('inspector.owner') == OWNER,'Volume ownership')
                        call('cleanup-volume-remove-'+role,['volume','rm',name],cap=8)
                    cleanup.append({'kind':'volume','name':name,'removed':True})
                except BaseException as exc:
                    cleanup.append({'kind':'volume','name':name,'error':str(exc)})
            if before is not None:
                for role,nid,name,internal in [('ingress',ingress,OWNER+'-ingress',False),('backend',network,OWNER,True)]:
                    if role not in network_plans:
                        continue
                    try:
                        code,data = call('cleanup-network-inspect-'+role,['network','inspect',nid or name],check=False,cap=5)
                        if code == 0:
                            obj = json.loads(data)[0]
                            require(obj['Name'] == name and obj['Labels'].get('inspector.owner') == OWNER
                                    and not obj['Containers'] and obj['Driver'] == 'bridge'
                                    and (nid is None or obj['Id'] == nid), 'Network ownership/identity/empty '+role)
                            require(obj['Internal'] is internal,'Network isolation '+role)
                            call('cleanup-network-remove-'+role,['network','rm',obj['Id']],cap=8)
                        cleanup.append({'kind':'network','role':role,'name':name,'id':nid,'removed':True})
                    except BaseException as exc:
                        cleanup.append({'kind':'network','role':role,'error':str(exc)})
            try:
                after = snapshot('after') if before is not None else None
                same = before == after if before is not None else not created and not volume_names and network is None and ingress is None
            except BaseException as exc:
                after, same = None, False
                cleanup.append({'kind':'neighborSnapshot','error':str(exc)})
            write('neighbor-sets.json',{'before':before,'after':after,'equal':same})
            try:
                for ref in ready['protectedFiles']:
                    pinned(ref)
                for ref in runtime_pins:
                    pinned(ref)
                require(sha(pathlib.Path(__file__).read_bytes()) == ready['runnerSha256'],'Runner changed during attempt')
                protected_unchanged = True
            except BaseException as exc:
                cleanup.append({'kind':'protectedPins','error':str(exc)})
            success = success and same and all('error' not in c and 'recoveryError' not in c for c in cleanup)
            if not success and error is None:
                error = 'Cleanup/neighbor set verification failed'
    write('outcome.json',{'status':'PASS_LOCAL_NORMAL_QUEUE_SUBSET_SMOKE' if success else ('FIRST_RED_RESOURCE' if resource_red else 'FIRST_RED_LOCAL_NORMAL_QUEUE_SMOKE'),
          'atUtc':utc(),'wallSeconds':round(time.monotonic()-started,3),'error':error,'commands':records,'checks':checks,
          'cleanup':cleanup,'neighborSetsEqual':same,'privateRemoved':not pathlib.Path(private).exists(),
          'protectedPinsUnchanged':protected_unchanged,'images':images,
          'minObservedMemAvailableKiB':min_available_kib,'memoryEvidence':'Point observations only; configured caps and docker-stats snapshots are not measured process peaks.',
          'boundaries':{'localCPU':True,'normalQueueSubset':success,
                        'fullSourceRealQueueRequested':args.full_source_pdf is not None,
                        'fullSourceRealQueuePassed':success and args.full_source_pdf is not None,'backendInternal':True,
                        'webOnlyNormalIngress':True,'webIngressEgressCapable':True,'externalProvidersCalled':False,
                        'freshTextWholeGolden':False,'engineering':False,
                        'calibration':False,'browser':False,'homeserverInstalled':False,'finalSubmission':False}})
    print(json.dumps({'status':'PASS' if success else 'FIRST_RED','error':error,'neighborSetsEqual':same}))
    return 0 if success else 1


if __name__ == '__main__':
    raise SystemExit(main())
