"""Retain bounded, redacted native tool errors, never raw credential-bearing logs."""
import base64
import json
import re


def retain_errors(native, environment, credentials):
    values = [value for key, value in environment.items()
              if re.search(r'SECRET|TOKEN|PASSWORD|CSC_LINK|API_KEY|PROVISIONING_PROFILE', key, re.I) and value]
    password = credentials / 'keychain-password'
    if password.is_file():
        values.append(password.read_text())
    values += [base64.b64encode(value.encode()).decode() for value in values]
    for log in native.glob('*.log'):
        text = log.read_text(errors='replace')
        text = re.sub(r'-----BEGIN [^-]+-----.*?(?:-----END [^-]+-----|\Z)', '[REDACTED PEM]', text, flags=re.S)
        for value in sorted(set(values), key=len, reverse=True):
            text = text.replace(value, '[REDACTED]')
        text = re.sub(r'(?i)(bearer\s+)[\w.+=/-]+', r'\1[REDACTED]', text)
        text = re.sub(r'(?i)((?:password|token|secret|authorization)\s*[=:]\s*)\S+', r'\1[REDACTED]', text)
        text = re.sub(r'(?<=://)[^/\s@]+@', '[REDACTED]@', text)
        text = re.sub(r'[A-Za-z0-9+/=_-]{120,}', '[REDACTED BLOB]', text)
        lines = text.splitlines()
        selected = set()
        errors = set()
        for index, line in enumerate(lines):
            context = range(max(0, index - 2), min(len(lines), index + 4))
            if re.search(r'(?:^|\S:\d+(?::\d+)?:\s+)(?:fatal\s+)?error:\s|^fatal\b', line, re.I):
                errors.update(context)
            if re.search(r'error\b|failed\b|fatal\b|codesign|provisioning|signing certificate', line, re.I):
                selected.update(context)
        # Compiler errors can precede thousands of warning/command lines in parallel builds.
        priority = set(sorted(errors)[:160])
        indices = sorted(priority | set(sorted(selected - priority)[-(240 - len(priority)):]))
        report = dict(stage=log.stem, totalLines=len(lines),
                      excerpts=[dict(line=i + 1, text=lines[i][:2000]) for i in indices])
        target = log.with_name(log.stem + '-diagnostics.json')
        target.write_text(json.dumps(report, indent=2) + '\n')
        print(target.name + ': ' + json.dumps(report))
