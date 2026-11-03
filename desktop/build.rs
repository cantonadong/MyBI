use std::{env, path::PathBuf, process::Command};

fn main() {
    slint_build::compile_with_config(
        "ui/main.slint",
        slint_build::CompilerConfiguration::new()
            .with_style("fluent-light".into())
            .embed_resources(slint_build::EmbedResourcesKind::EmbedFiles),
    )
    .expect("compile service manager UI");
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    if env::var("CARGO_CFG_TARGET_ENV").unwrap() == "msvc" {
        let kits =
            PathBuf::from(env::var_os("ProgramFiles(x86)").unwrap()).join("Windows Kits/10/bin");
        let mut versions: Vec<_> = std::fs::read_dir(kits)
            .expect("Windows SDK is required")
            .filter_map(Result::ok)
            .map(|entry| entry.path().join("x64/rc.exe"))
            .filter(|path| path.is_file())
            .collect();
        versions.sort();
        let resource = output.join("mybi.res");
        let status = Command::new(versions.last().expect("Windows SDK rc.exe is required"))
            .arg("/nologo")
            .arg("/fo")
            .arg(&resource)
            .arg("app.rc")
            .status()
            .expect("run resource compiler");
        assert!(status.success(), "compile Windows icon resource");
        println!("cargo:rustc-link-arg={}", resource.display());
    } else {
        let resource = output.join("mybi-icon.o");
        let status = Command::new("x86_64-w64-mingw32-windres")
            .args(["-i", "app.rc", "-O", "coff", "-o"])
            .arg(&resource)
            .status()
            .expect("run resource compiler");
        assert!(status.success(), "compile Windows icon resource");
        println!("cargo:rustc-link-arg={}", resource.display());
    }
    println!("cargo:rerun-if-changed=app.rc");
    println!("cargo:rerun-if-changed=../design/icon.ico");
    println!("cargo:rerun-if-changed=../frontend/src/locales/en.json");
}
