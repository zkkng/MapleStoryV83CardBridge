ARG MAVEN_IMAGE=maven:3.9.9-eclipse-temurin-21
ARG JAVA_IMAGE=eclipse-temurin:21-jre-jammy
FROM ${MAVEN_IMAGE} AS build
WORKDIR /build
COPY cosmic/pom.xml ./pom.xml
COPY cosmic/src ./src
COPY cosmic/wz ./wz
COPY cosmic/scripts ./scripts
COPY support/test-config.yaml ./config.yaml
RUN mvn -B test package
COPY support/AccountCommand.java /support/AccountCommand.java
RUN javac --release 21 -cp target/Cosmic.jar -d /support /support/AccountCommand.java

FROM ${JAVA_IMAGE}
WORKDIR /opt/server
RUN groupadd --gid 10001 cosmic && useradd --uid 10001 --gid cosmic --no-create-home cosmic
COPY --from=build /build/target/Cosmic.jar ./Server.jar
COPY --from=build /build/wz ./wz
COPY --from=build /build/scripts ./scripts
COPY cosmic/LICENSE ./LICENSE
COPY --from=build /support/AccountCommand.class /opt/card-tools/AccountCommand.class
RUN mkdir logs cache && chown cosmic:cosmic logs cache
USER 10001:10001
ENTRYPOINT ["java", "-Xms256m", "-Xmx1024m", "-jar", "Server.jar"]
