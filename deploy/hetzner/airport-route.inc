# Include inside the labpulse.ai HTTPS server before its location / redirect.
# The password file is generated on the server, never committed.
location = /airport {
    return 308 /airport/$is_args$args;
}
location ^~ /airport/ {
    auth_basic "Airport Twin Core - Private Pilot";
    auth_basic_user_file /etc/nginx/ssl/airport-demo.htpasswd;
    limit_req zone=api burst=60 nodelay;
    client_max_body_size 6m;
    proxy_pass http://172.17.0.1:18576/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Authorization "";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Prefix /airport;
    proxy_read_timeout 130s;
    proxy_buffering off;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    add_header Cache-Control "private, no-store" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
}
